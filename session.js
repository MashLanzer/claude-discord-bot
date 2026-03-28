const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const stripAnsi = require('strip-ansi');
const fs = require('fs');
const path = require('path');

// Función auxiliar para dibujar el Mini-Mapa del proyecto
function getMiniTree(dir) {
    try {
        const files = fs.readdirSync(dir).filter(f => !f.startsWith('.') && f !== 'node_modules');
        let tree = '';
        files.slice(0, 15).forEach(f => {
            const isDir = fs.lstatSync(path.join(dir, f)).isDirectory();
            tree += `├─ ${isDir ? '📁' : '📄'} ${f}\n`;
        });
        if (files.length > 15) tree += '└─ ... más archivos ocultos\n';
        return tree || 'Carpeta vacía';
    } catch(e) { return 'No se pudo leer el directorio'; }
}

class ClaudeSession {
    constructor(userId, channel, initialCwd = null) {
        this.userId = userId;
        this.channel = channel;
        this.sendTimeout = null;
        this.currentCwd = initialCwd || process.cwd();
        
        // El emulador de terminal headless nos da el texto exacto sin secuencias raras
        this.term = new Terminal({
            cols: 120,
            rows: 200, // Alto para guardar historial en memoria visual
            scrollback: 1000,
            allowProposedApi: true
        });
        this.interactionStartIndex = 0;
        this.currentDiscordMessage = null;
        this.outputDelay = 2000; // Editar cada 2.0s para efecto en "tiempo real"
        this.replyWithVoice = false; // Flag de respuesta auditiva

        const CLAUDE_PATH = process.env.CLIPATH || 'c:\\Users\\Mash\\claude-discord-bot\\claude-free.bat';

        this.ptyProcess = pty.spawn('cmd.exe', ['/c', CLAUDE_PATH], {
            name: 'xterm-color',
            cols: 120,
            rows: 200,
            cwd: this.currentCwd,
            env: { ...process.env, FORCE_COLOR: '0' } // Desactiva colores en el proceso
        });

        this.ptyProcess.on('data', (data) => {
            const strData = data.toString();
            
            // Auto-aceptar la advertencia de modo peligroso (menú TUI que requiere flechas direccionales)
            if (strData.includes('Yes, I accept') || strData.includes('Bypass Permissions mode')) {
                // Enviar Flecha Abajo y luego Enter
                this.ptyProcess.write('\x1B[B\r');
            }

            // Escribir datos reales a la terminal virtual para que la dibuje internamente
            this.term.write(data);
            
            if (this.sendTimeout) {
                clearTimeout(this.sendTimeout);
            }
            
            // Rebotar envio a discord
            this.sendTimeout = setTimeout(() => {
                this.flush();
            }, this.outputDelay);
        });

        // --- 🛡️ MEJORA 4: Watchdog del Sistema ---
        this.ptyProcess.on('exit', (code) => {
            console.log(`[WATCHDOG] El proceso PTY se cerró con código ${code}.`);
            this.channel.send(`⚠️ *Alerta del Sistema:* Claude Code se ha cerrado, reiniciado o ha crasheado (Código: ${code}).\nEscribe cualquier texto para levantar el socket de nuevo.`).catch(()=>{});
        });
    }

    async flush() {
        const activeBuffer = this.term.buffer.active;
        let newLines = [];
        let maxLine = 0;

        // Extraer todo el texto que actualmente está renderizado en la terminal paralela
        for (let i = 0; i < activeBuffer.length; i++) {
            const line = activeBuffer.getLine(i);
            if (!line) continue;
            const text = line.translateToString(true).trimRight();
            if (text) maxLine = i;
        }

        // Si alguna de las últimas 3 líneas del buffer termina en '>', Claude ha terminado su turno
        // (A veces Claude dibuja barras de estado debajo del prompt, por eso revisamos las últimas 3)
        let isDone = false;
        for (let i = maxLine; i >= Math.max(0, maxLine - 3); i--) {
            const l = activeBuffer.getLine(i)?.translateToString(true).trim();
            if (l === '>' || l.endsWith('>')) {
                isDone = true;
                break;
            }
        }

        // Recuperar todo el bloque *completo* desde la última interacción
        for (let i = this.interactionStartIndex; i <= maxLine; i++) {
            const line = activeBuffer.getLine(i);
            if (line) {
                let text = line.translateToString(true);
                if (text.trim()) {
                    // Remover iconos de Claude y el "Composing..." comun
                    text = text.replace(/;✳ Claude Code.*/g, '');
                    text = text.replace(/✽ Composing…/g, '');
                    text = text.replace(/;⠂ Claude Code/g, '');
                    text = text.replace(/\? for shortcuts ◐ medium · \/ effort/gi, '');
                    text = text.replace(/.*esc to interrupt.*/g, '');
                    text = text.replace(/.*\(thinking\).*/gi, ''); 
                    text = text.replace(/.*Galloping.*/gi, '');
                    
                    text = text.replace(/.*▐▛███▜▌.*/g, '');
                    text = text.replace(/.*▝▜█████▛▘.*/g, '');
                    text = text.replace(/.*▘▘ ▝▝.*/g, '');
                    text = text.replace(/.*Claude Code v2.*/gi, '');
                    text = text.replace(/.*openrouter\/free.*/gi, '');
                    text = text.replace(/.*API Usage Billing.*/gi, '');
                    text = text.replace(/.*~\\claude-discord-bot.*/gi, '');
                    
                    text = text.replace(/.*⏵⏵ bypass permissions.*/gi, '');
                    text = text.replace(/.*MCP servers failed.*/gi, '');
                    text = text.replace(/.*shift\+tab to cycle.*/gi, '');

                    text = text.replace(/^[> ]+$/g, '');
                    
                    if (text.trim()) newLines.push(text);
                }
            }
        }
        
        let toSend = newLines.join('\n').trim();

        // Limpieza agresiva de diseño de terminal
        toSend = toSend.replace(/[─┌┐└┘├┤┬┴┼│═]/g, '');
        toSend = toSend.replace(/^[> ]+$/gm, ''); // Remover cualquier flecha de prompt vacía
        toSend = toSend.replace(/\n{2,}/g, '\n\n').trim();

        // Evitar fallos si hay demasiado log de herramientas (Límite de Discord es 4096)
        if (toSend.length > 4000) {
            toSend = '... [Texto truncado] ...\n' + toSend.slice(-3900);
        }

        if (!toSend && !isDone) return;

        let components = [];
        
        if (toSend.toLowerCase().includes('enter to confirm') || toSend.toLowerCase().includes('esc to cancel') || toSend.toLowerCase().includes('yes, i accept')) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('tui_up').setLabel('⬆️ Subir').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('tui_down').setLabel('⬇️ Bajar').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('tui_enter').setLabel('✅ Enter').setStyle(ButtonStyle.Primary)
                );
            components.push(row);
        }

        if (toSend) {
            // --- 🧰 MEJORA 5: Extracción Visual de Herramientas ---
            let toolsUsed = [];
            const toolMatches = [...toSend.matchAll(/● ([a-zA-Z0-9_\-]+ - [a-zA-Z0-9_\-]+)/g)];
            for (let m of toolMatches) {
                if (!toolsUsed.includes(m[1])) toolsUsed.push(m[1]);
            }

            // Borrar el SPAM visual de las herramientas usadas (argumentos largos y JSONs de respuesta) del chat central
            // Match: ● Herramienta - Accion (MCP) ...texto hasta la siguiente viñeta o final
            toSend = toSend.replace(/● [a-zA-Z0-9_\-]+ - [a-zA-Z0-9_\-]+ \((MCP|local|system)\)[\s\S]*?(?=(\n● |\n>|\n\n|$))/g, '');
            // Match: ⎿ { "resultado" } ...texto hasta la siguiente viñeta
            toSend = toSend.replace(/⎿[\s\S]*?(?=(\n● |\n>|\n\n|$))/g, ''); 
            
            // Re-limpiar lineas vacias extra
            toSend = toSend.replace(/\n{3,}/g, '\n\n').trim();

            const embed = new EmbedBuilder()
                .setColor('#D97757')
                .setAuthor({ name: 'Claude Code (Terminal)', iconURL: 'https://mintlify.s3-us-west-1.amazonaws.com/anthropic/logo/dark.png' })
                .setDescription(isDone ? (toSend || '*✓ Completado*') : (toSend || '') + '\n\n*⏳ Cargando...*');

            // --- 🌳 MEJORA 3: Mini-Mapa del Proyecto y 🧠 CLAUDE.md ---
            let footerText = `📂 Proyecto: ${path.basename(this.currentCwd)}`;
            if (fs.existsSync(path.join(this.currentCwd, 'CLAUDE.md'))) {
                footerText += ` | 📜 CLAUDE.md activo`;
            }
            // Insertar herramientas en el Footer
            if (toolsUsed.length > 0) {
                footerText += '\n🛠️ Herramientas ejecutadas en este turno:\n' + toolsUsed.join(', ');
            }
            embed.setFooter({ text: footerText });

            // Mostrar el Mini-Mapa del proyecto cuando ha terminado de cargar
            if (isDone) {
                // --- 🟢🔴 MEJORA 4: Code Diffs Lector de Cambios Reales ---
                const fileChanged = toolsUsed.some(t => t.includes('file') || t.includes('replace') || t.includes('edit'));
                if (fileChanged) {
                    try {
                        const { execSync } = require('child_process');
                        // Intenta sacar el diff real de git si existe un repositorio inicializado
                        const diff = execSync('git diff -U1', { cwd: this.currentCwd, encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (diff) {
                            let cleanDiff = diff.length > 900 ? diff.substring(0, 900) + '\n...[Diff muy grande truncado]' : diff;
                            embed.addFields({ name: '📝 Cambios de Código Detectados (Git)', value: '```diff\n' + cleanDiff + '\n```' });
                        }
                    } catch(e) {
                         // Ignorar si no hay reporsitorio git o si falla el diff
                    }
                }

                embed.addFields({ name: '🗂️ Estado del Proyecto', value: '```text\n' + getMiniTree(this.currentCwd) + '\n```' });
            }

            const msgData = { embeds: [embed] };
            if (components.length > 0) msgData.components = components;

            try {
                if (this.currentDiscordMessage) {
                    await this.currentDiscordMessage.edit(msgData);
                } else {
                    this.currentDiscordMessage = await this.channel.send(msgData);
                }
            } catch (err) {
                console.error("Error editando/creando mensaje:", err.message);
                this.currentDiscordMessage = await this.channel.send(msgData).catch(() => {});
            }

            // --- 📢 MEJORA 1: Voice (TTS) ---
            if (isDone && this.replyWithVoice && toSend.trim()) {
                this.replyWithVoice = false; // Apagar flag
                try {
                    let ttsText = toSend.replace(/```[\s\S]*?```/g, ' [Se ha generado un bloque de código oculto] ');
                    ttsText = ttsText.replace(/[#*_~`]/g, '').trim().substring(0, 190);
                    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(ttsText)}&tl=es`;
                    const res = await fetch(url);
                    const arrayBuffer = await res.arrayBuffer();
                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(Buffer.from(arrayBuffer), { name: 'claude_voice.mp3' });
                    await this.channel.send({ content: '🔊 **Claude AI:**', files: [attachment] });
                } catch(e) { console.error("Error TTS:", e.message); }
            }

            // --- 🗺️ MEJORA 5c: Render automático de diagramas Mermaid ---
            if (isDone) {
                const mermaidCode = toSend.match(/```mermaid\n([\s\S]*?)```/);
                if (mermaidCode && mermaidCode[1]) {
                    try {
                        const mCode = mermaidCode[1].trim();
                        const qcUrl = `https://quickchart.io/mermaid?graph=${encodeURIComponent(mCode)}&bkg=white`;
                        const res = await fetch(qcUrl);
                        if (res.ok) {
                            const buffer = Buffer.from(await res.arrayBuffer());
                            const { AttachmentBuilder } = require('discord.js');
                            const mAttach = new AttachmentBuilder(buffer, { name: 'diagrama.png' });
                            await this.channel.send({ content: '🖨️ **Agente Dibujante:** He renderizado tu diagrama visualmente:', files: [mAttach] }).catch(()=>{});
                        }
                    } catch(e) { console.error("Error Render Mermaid:", e.message); }
                }
            }
        }

        if (isDone) {
            this.interactionStartIndex = maxLine + 1; // Mover punto de partida para que la proxima pregunta sea texto nuevo
            this.currentDiscordMessage = null; // Liberar referencia del mensaje para empezar otro
        }
    }

    chunkText(text, maxLength = 1900) {
        const chunks = [];
        let current = '';
        const lines = text.split('\n');
        for (const line of lines) {
            if (current.length + line.length > maxLength) {
                if (current.trim()) chunks.push(current);
                current = line + '\n';
            } else {
                current += line + '\n';
            }
        }
        if (current.trim()) chunks.push(current);
        return chunks;
    }

    write(input) {
        this.ptyProcess.write(input + '\r');
    }

    destroy() {
        if (this.sendTimeout) clearTimeout(this.sendTimeout);
        this.term.dispose();
        this.ptyProcess.kill();
    }
}

module.exports = ClaudeSession;
