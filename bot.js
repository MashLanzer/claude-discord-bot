const { Client, GatewayIntentBits, Partials, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const requireDotenv = require('dotenv');
requireDotenv.config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const stripAnsi = require('strip-ansi');
const FormData = require('form-data');
const screenshot = require('screenshot-desktop');
const cron = require('node-cron');
const ClaudeSession = require('./session');

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID; // ID de Discord del desarrollador
const GROQ_API_KEY = process.env.GROQ_API_KEY || "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"; // Transcripciones 🎙️

// Configuración del cliente
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// Mapa de sesiones activas por ID de usuario
const activeSessions = new Map();
const userExplorers = new Map();

// Definición Maestra de Comandos Slash (/)
const commands = [
    new SlashCommandBuilder().setName('assets').setDescription('Generar imagen IA').addStringOption(o => o.setName('prompt').setDescription('Imagen a generar').setRequired(true)),
    new SlashCommandBuilder().setName('review').setDescription('Hacer Code Review de Git diff'),
    new SlashCommandBuilder().setName('db').setDescription('Visualizar BD SQLite').addStringOption(o => o.setName('archivo').setDescription('Ej: database.sqlite').setRequired(true)),
    new SlashCommandBuilder().setName('memory').setDescription('Editar el archivo CLAUDE.md visualmente'),
    new SlashCommandBuilder().setName('watch').setDescription('Auto-Healer Monitor').addStringOption(o => o.setName('comando').setDescription('Ej: npm start').setRequired(true)),
    new SlashCommandBuilder().setName('expose').setDescription('Túnel web inverso').addIntegerOption(o => o.setName('puerto').setDescription('Ej: 3000').setRequired(true)),
    new SlashCommandBuilder().setName('explorer').setDescription('Explorador visual nativo'),
    new SlashCommandBuilder().setName('research').setDescription('Agente buscador web').addStringOption(o => o.setName('tema').setDescription('Ej: Novedades de Godot 4').setRequired(true)),
    new SlashCommandBuilder().setName('vision').setDescription('Tomar captura de monitores y pedir análisis'),
    new SlashCommandBuilder().setName('restart').setDescription('Reiniciar terminal Claude Code'),
    new SlashCommandBuilder().setName('stop').setDescription('Detener terminal Claude Code'),
    new SlashCommandBuilder().setName('sys').setDescription('Ver telemetría local de Windows'),
    new SlashCommandBuilder().setName('export').setDescription('Exportar historia visual activa'),
    new SlashCommandBuilder().setName('mcp').setDescription('Abrir sistema MCP Manager'),
    new SlashCommandBuilder().setName('cd').setDescription('Ir a otra carpeta').addStringOption(o => o.setName('ruta').setDescription('Ruta abosluta Windows').setRequired(true)),
    new SlashCommandBuilder().setName('syscmd').setDescription('Ejecutar CMD en Windows directo').addStringOption(o => o.setName('comando').setDescription('Ej: dir').setRequired(true)),
    new SlashCommandBuilder().setName('clone').setDescription('Clonar repositorio Github y montar').addStringOption(o => o.setName('url').setDescription('URL Git').setRequired(true)),
    new SlashCommandBuilder().setName('cron').setDescription('Programar trabajo en segundo plano').addStringOption(o => o.setName('horario').setDescription('Ej: */5 * * * *').setRequired(true)).addStringOption(o => o.setName('tarea').setDescription('Instrucción para Claude').setRequired(true))
];

// Función para el Explorador de Archivos Visual (!explorer)
async function sendExplorer(channel, sessionId, dirPath) {
    try {
        const items = fs.readdirSync(dirPath).filter(f => !f.startsWith('.')).slice(0, 24);
        let options = [];
        const parentDir = path.dirname(dirPath);
        options.push({ label: '⬅️ Atrás [Subir Nivel]', value: 'DIR_UP', description: 'Ir a ' + path.basename(parentDir), emoji: '🔙' });
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            let isDir = false;
            try { isDir = fs.lstatSync(itemPath).isDirectory(); } catch(e){}
            options.push({
                label: item.substring(0, 95),
                value: 'SEL_' + itemPath.substring(0, 80),
                description: isDir ? 'Entrar a la carpeta' : 'Inyectar a la IA rápida',
                emoji: isDir ? '📁' : '📄'
            });
        }
        if (options.length === 0) options.push({ label: 'Carpeta Vacía', value: 'IGNORE', description: 'Sin contenido en ' + path.basename(dirPath) });

        const row1 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('explorer_menu').setPlaceholder('📁 Navegar localmente por tu PC...').addOptions(options)
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('exp_mount').setLabel('🔥 Transportar el Agente (Claude) aquí (!cd)').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `📍 **Explorador GUI del Sistema Host**\nRuta Actual: \`${dirPath}\``, components: [row1, row2] });
    } catch(e) { channel.send(`❌ Error bloqueante en Explorador: ${e.message}`); }
}

// Manejar mensajes
client.on('messageCreate', async (message) => {
    // Ignorar mensajes de bots
    if (message.author.bot) return;

    // 🛡️ BARRERA DE SEGURIDAD (Lista Blanca)
    // Si se definió un ID de usuario permitido en el .env, rechazar a todos los demás
    if (ALLOWED_USER_ID && message.author.id !== ALLOWED_USER_ID) {
        console.log(`[SEGURIDAD] Intento de acceso bloqueado del usuario: ${message.author.tag} (${message.author.id})`);
        // Opcional: Responder con advertencia
        // await message.channel.send('Acceso denegado: No tienes permisos de administrador en este servidor.');
        return;
    }
    
    // Si ALLOWED_USER_ID no está en tu .env, te mostramos tu ID para que lo copies
    if (!ALLOWED_USER_ID) {
        console.log(`[AVISO SEGURIDAD] Tu Discord ID es: ${message.author.id}. ¡Ponlo como ALLOWED_USER_ID= en tu .env para proteger tu bot!`);
    }

    // 🌐 MEJORA 4b: Multi-Agentes de Discord (Servidor vs DM)
    // Permite al bot operar en servidores, mapeando las sesiones de Claude POR CANAL (sessionId)
    const sessionId = message.channel.id;
    let session = activeSessions.get(sessionId);
    let finalInputText = message.content.trim();

        // --- 📂 MEJORA 3 Y 1: Leer archivos adjuntos de Discord y Notas de Voz (Whisper) ---
        if (message.attachments.size > 0) {
            const tempDir = path.join(process.cwd(), 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            
            const savedFiles = [];
            for (const [id, attachment] of message.attachments) {
                try {
                    const res = await fetch(attachment.url);
                    const arrayBuffer = await res.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    
                    // Si es una NOTA DE VOZ o Audio (Groq Whisper)
                    if (attachment.contentType && attachment.contentType.startsWith('audio/')) {
                        await message.channel.send("🎙️ *Escuchando y transcribiendo tu nota de voz con Groq Whisper...*");
                        
                        const formData = new FormData();
                        formData.append("file", buffer, { filename: "audio.ogg", contentType: attachment.contentType });
                        formData.append("model", "whisper-large-v3-turbo");
                        
                        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                            method: "POST",
                            headers: { 
                                "Authorization": `Bearer ${GROQ_API_KEY}`,
                                ...formData.getHeaders()
                            },
                            body: formData
                        });
                        
                        const json = await groqRes.json();
                        if (json.text) {
                            finalInputText = finalInputText ? finalInputText + "\n" + json.text : json.text;
                            await message.channel.send(`🗣️ **Tú dijiste:** "${json.text}"`);
                            if (session) session.replyWithVoice = true; // Activar el TTS de respuesta
                        } else {
                            await message.channel.send("❌ *No se pudo transcribir el audio.*");
                        }
                    } else {
                        // Es un archivo normal (Foto, PDF, código)
                        const filePath = path.join(tempDir, attachment.name);
                        fs.writeFileSync(filePath, buffer);
                        savedFiles.push(filePath);
                    }
                } catch(e) {
                    console.error("Error descargando archivo/audio:", e);
                }
            }
            if (savedFiles.length > 0) {
                const filesContext = `\n\nAnaliza los siguientes archivos locales agregados manualmente al contexto:\n` + savedFiles.map(f => `"${f}"`).join('\n');
                finalInputText = finalInputText + filesContext;
                await message.react('📎').catch(() => {});
            }
        }

        // --- 👁️ MEJORA 1b: Visión Ocular (!vision) ---
        if (finalInputText.toLowerCase() === '!vision') {
            await message.channel.send('📸 **Capturando pantalla(s) del Host...**');
            try {
                const tempDir = path.join(process.cwd(), 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const screenPath = path.join(tempDir, `vision_${Date.now()}.png`);
                await screenshot({ filename: screenPath });
                
                const visionContext = `\n\nAnaliza detenidamente esta captura reciente de mi pantalla: "${screenPath}"\nDime si ves algún error o describe lo que observas detalladamente.`;
                finalInputText = visionContext;
                await message.channel.send(`🖼️ **Pantalla capturada**. Archivo inyectado al caché neuronal de Claude.`);
            } catch(e) { 
                await message.channel.send('❌ Error de captura: ' + e.message); 
                return;
            }
        }

        // --- ⌨️ MEJORA 5b: Ejecución Host Directa Inseparable (!syscmd) ---
        if (finalInputText.toLowerCase().startsWith('!syscmd ')) {
            const cmd = finalInputText.substring(8).trim();
            const cwd = session ? session.currentCwd : process.cwd();
            await message.channel.send(`💻 **Ejecutando en OS Host:** \`${cmd}\``);
            exec(cmd, { cwd }, (error, stdout, stderr) => {
                const out = stdout || stderr || (error ? error.message : "Comando terminado sin salida.");
                const clean = out.length > 1900 ? out.substring(0, 1900) + '...[Trunco]' : out;
                message.channel.send(`\`\`\`text\n${clean}\n\`\`\``).catch(()=>{});
            });
            return;
        }

        // --- 🐙 MEJORA 3b: Auto-Clonado de Repositorios GitHub (!clone) ---
        if (finalInputText.toLowerCase().startsWith('!clone ')) {
            const url = finalInputText.substring(7).trim();
            const repoName = url.split('/').pop().replace('.git', '');
            const reposDir = path.join(process.cwd(), 'repos');
            if (!fs.existsSync(reposDir)) fs.mkdirSync(reposDir);
            const newPath = path.join(reposDir, repoName);
            
            await message.channel.send(`📥 **Clonando GitHub:** \`${url}\`...`);
            exec(`git clone ${url} "${newPath}"`, async (error, stdout, stderr) => {
                const out = stdout || stderr || '';
                if (error) return message.channel.send(`❌ **Error de Git:**\n\`\`\`text\n${out}\n\`\`\``);
                
                if (session) {
                    session.destroy();
                    activeSessions.delete(sessionId);
                }
                session = new ClaudeSession(message.author.id, message.channel, newPath);
                activeSessions.set(sessionId, session);
                await message.channel.send(`✅ **Repositorio Clonado Exitosamente.**\nSesión iniciada remotamente en: \`${newPath}\``);
            });
            return;
        }

        // --- 🏥 MEJORA 1c: Auto-Healer Crash Interceptor (!watch) ---
        if (finalInputText.toLowerCase().startsWith('!watch ')) {
            const cmd = finalInputText.substring(7).trim();
            const cwd = session ? session.currentCwd : process.cwd();
            await message.channel.send(`🏥 **Escudo Auto-Healer Activado.** Observando el servidor (Host):\n\`${cmd}\``);
            
            const childProc = exec(cmd, { cwd });
            let errBuffer = '';
            
            childProc.stderr.on('data', (data) => errBuffer += data.toString());
            
            childProc.on('exit', async (code) => {
                if (code !== 0 && errBuffer.trim()) {
                    await message.channel.send(`⚠️ **CRASH DETECTADO (Cod: ${code}).**\nInterceptando el Stack Trace en Rojo y solicitando a Claude la Auto-Reparación de la app...`);
                    const repairPrompt = `El servidor que ejecutaste (con el comando "${cmd}") acaba de crashear miserablemente con este error de Stack Trace:\n\n${errBuffer}\n\nPor favor, lee el error exacto, localiza el archivo corrupto, edita el código fuente para sanarlo y descríbeme todo lo que arreglaste en 2 oraciones.`;
                    if (session) {
                        session.write(repairPrompt);
                    } else {
                        session = new ClaudeSession(message.author.id, message.channel, cwd);
                        activeSessions.set(sessionId, session);
                        setTimeout(() => session.write(repairPrompt), 2500);
                    }
                } else {
                    message.channel.send(`✅ Proceso del servidor finalizado ordenadamente.`);
                }
            });
            return;
        }

        // --- 🌐 MEJORA 2c: Túnel Inverso Host-Celular (!expose) ---
        if (finalInputText.toLowerCase().startsWith('!expose ')) {
            const port = parseInt(finalInputText.substring(8).trim(), 10);
            if (isNaN(port)) return message.channel.send("❌ Especifica un puerto numérico. Ej: `!expose 3000`");
            
            await message.channel.send(`🌐 **Creando Puente Espacial (Túnel Inverso) hacia el puerto localhost \`${port}\`...**`);
            try {
                const localtunnel = require('localtunnel');
                const tunnel = await localtunnel({ port: port });
                await message.channel.send(`🔗 **¡Túnel Desbloqueado!**\nYa puedes acceder a tu juego HTML5/App Web en vivo remotamente desde el celular y dándole click aquí 👇:\n👉 ${tunnel.url}`);
            } catch(e) { message.channel.send(`❌ Error al crear túnel reverso: ${e.message}`); }
            return;
        }

        // --- 📁 MEJORA 3c: Explorador Visual con Botones (!explorer) ---
        if (finalInputText.toLowerCase() === '!explorer') {
            const cwd = session ? session.currentCwd : process.cwd();
            userExplorers.set(sessionId, cwd);
            await sendExplorer(message.channel, sessionId, cwd);
            return;
        }

        // --- 🕸️ MEJORA 4c: Sub-Agente Web Scraper (!research) ---
        if (finalInputText.toLowerCase().startsWith('!research ')) {
            const topic = finalInputText.substring(10).trim();
            await message.channel.send(`🕷️ **Sub-Agente Desplegado a Internet.**\nBuscando rastros recientes de: \`${topic}\` ...`);
            try {
                const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic)}`);
                const html = await searchRes.text();
                const snippets = [...html.matchAll(/class="result__snippet[^>]*>(.*?)<\/a>/gi)];
                let compilado = '';
                snippets.slice(0, 5).forEach(m => {
                    compilado += '- ' + m[1].replace(/<[^>]*>?/gm, '').trim() + '\n';
                });
                
                const researchContext = `He lanzado un Sub-Agente Fantasma que leyó el internet sobre la actualidad de "${topic}". Sus 5 extractos recolectados en vivo son:\n${compilado || 'No encontré rastros.'}\nPor favor asimila esta data en tu subconsciente y dame una respuesta concisa tomando en cuenta esa información externa.`;
                if (session) session.write(researchContext);
                else {
                    let activeSession = new ClaudeSession(message.author.id, message.channel, process.cwd());
                    activeSessions.set(sessionId, activeSession);
                    setTimeout(() => activeSession.write(researchContext), 2500);
                }
                await message.channel.send(`✅ **Datos web absorbidos e inyectados al Contexto.**`);
            } catch (e) { message.channel.send(`❌ Araña Cibernética falló: ${e.message}`); }
            return;
        }

        // --- 🤖 EXTRA: Auto-Revisor de Código Inteligente (!review) ---
        if (finalInputText.toLowerCase() === '!review') {
            const cwd = session ? session.currentCwd : process.cwd();
            await message.channel.send(`🔍 **Ejecutando Code Review Crítico en Git...**`);
            exec('git diff', { cwd }, (error, stdout, stderr) => {
                if (!stdout || !stdout.trim()) return message.channel.send('✅ **Git Diff Vacío**: No hay cambios sin guardar para revisar.');
                const diffClean = stdout.length > 2000 ? stdout.substring(0, 2000) + '\n...[Trunco]' : stdout;
                const reviewPrompt = `Actúa como un **Ingeniero Senior**. Aquí están mis cambios actuales (Git Diff) que aún no guardo en commits:\n\n\`\`\`diff\n${diffClean}\n\`\`\`\nAnaliza estos cambios, detecta bugs lógicos profundos, fugas de memoria o problemas de sintaxis, y hazme un Código Review de extrema rigurosidad.`;
                if (session) session.write(reviewPrompt);
                else {
                    let activeSession = new ClaudeSession(message.author.id, message.channel, cwd);
                    activeSessions.set(sessionId, activeSession);
                    setTimeout(() => activeSession.write(reviewPrompt), 2500);
                }
            });
            return;
        }

        // --- 🎨 EXTRA: Motor Generador de Assets IA (!assets) ---
        if (finalInputText.toLowerCase().startsWith('!assets ')) {
            const prompt = finalInputText.substring(8).trim();
            await message.channel.send(`🎨 **Generador de Assets IA Trabajando...**\nCreando material gráfico de: \`${prompt}\``);
            try {
                const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
                const mAttach = new AttachmentBuilder(url, { name: 'asset_generado.png' });
                await message.channel.send({ content: `✅ **Material Gráfico Producido:**`, files: [mAttach] });
            } catch(e) { message.channel.send("❌ Motor GPU sobrecargado o error al generar imagen."); }
            return;
        }

        // --- 🧠 EXTRA: Gestor Cognitivo Visual CLAUDE.md (!memory) ---
        if (finalInputText.toLowerCase() === '!memory') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_open_memory').setLabel('✏️ Modificar Memoria Nativa (CLAUDE.md)').setStyle(ButtonStyle.Primary)
            );
            return message.channel.send({ content: '🧠 **Panel de Administración Subconsciente**\n*Da clic para sobreescribir las leyes e instrucciones principales del bot:*', components: [row] });
        }

        // --- 🗄️ EXTRA: Analizador Base de Datos SQL (!db) ---
        if (finalInputText.toLowerCase().startsWith('!db ')) {
            const dbPath = finalInputText.substring(4).trim();
            const absPath = path.isAbsolute(dbPath) ? dbPath : path.join(session ? session.currentCwd : process.cwd(), dbPath);
            if (!fs.existsSync(absPath)) return message.channel.send(`❌ Archivo de Base de Datos DB/SQLite inexistente en: ${absPath}`);
            await message.channel.send(`🗄️ **Abriendo conexión directa a SQLite en:** \`${path.basename(absPath)}\`...`);
            
            const db = new sqlite3.Database(absPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) return message.channel.send("❌ Crash SQLite: " + err.message);
                db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
                    if (err || !tables || tables.length === 0) return message.channel.send("❌ Archivo válido, pero no hay tablas de arquitectura.");
                    let schemaStr = "🗄️ **Diagrama Estructural en Tiempo Real:**\n";
                    let count = 0;
                    tables.forEach(row => {
                        db.all(`PRAGMA table_info(${row.name})`, [], (e, cols) => {
                            schemaStr += `\n**Tabla [${row.name}]**\n> 🔸 ` + cols.map(c => `\`${c.name}\` *${c.type}*`).join('  |  ');
                            count++;
                            if (count === tables.length) message.channel.send({ content: schemaStr.substring(0, 1980) });
                        });
                    });
                });
            });
            return;
        }

        // --- ⏰ MEJORA 2b: Automatización Tareas Cron (!cron) ---
        if (finalInputText.toLowerCase().startsWith('!cron ')) {
            const parts = finalInputText.split('"');
            if (parts.length >= 3) {
                const schedule = parts[1].trim();
                const task = parts[2].trim();
                await message.channel.send(`⏰ **Trabajo Programado Registrado.**\nHorario Cron: \`${schedule}\`\nTarea a enviar: \`${task}\``);
                
                cron.schedule(schedule, () => {
                    message.channel.send(`⏱️ **[CRON Ejecutando Tarea Programada]:** ${task}`);
                    let activeSession = activeSessions.get(sessionId);
                    if (activeSession) { 
                       activeSession.write(task); 
                    } else {
                       activeSession = new ClaudeSession(message.author.id, message.channel);
                       activeSessions.set(sessionId, activeSession);
                       setTimeout(() => activeSession.write(task), 2000);
                    }
                });
            } else {
                await message.channel.send('❌ Formato inválido. Ejemplo: `!cron "*/30 * * * *" Revisa los logs de error`.');
            }
            return;
        }

        const textLower = finalInputText.toLowerCase();

        // --- 🗂️ Cambio de Carpeta de Proyecto (!cd) ---
        if (textLower.startsWith('!cd ')) {
            const newPath = finalInputText.substring(4).trim();
            // Comprobar si existe localmente en el PC
            if (fs.existsSync(newPath) && fs.lstatSync(newPath).isDirectory()) {
                if (session) {
                    session.destroy();
                    activeSessions.delete(sessionId);
                }
                session = new ClaudeSession(message.author.id, message.channel, newPath);
                activeSessions.set(sessionId, session);
                await message.channel.send(`📂 **Proyecto cambiado exitosamente.**\nClaude ahora operará por defecto en:\n\`${newPath}\``);
            } else {
                await message.channel.send(`❌ **Ruta no encontrada o no válida en tu disco duro:** \n\`${newPath}\``);
            }
            return;
        }

        // --- 📊 Telemetría / Vitals (!sys) ---
        if (textLower === '!sys' || textLower === '!vitals') {
            const memTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
            const memFree = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
            const cpus = os.cpus();
            const uptime = (os.uptime() / 3600).toFixed(1);
            
            await message.channel.send(`📊 **Telemetría del Sistema (PC Local):**\n\`\`\`text\nProcesador: ${cpus[0].model}\nNúcleos lógicos: ${cpus.length}\nRAM Libre: ${memFree} GB / ${memTotal} GB\nTiempo de actividad: ${uptime} horas\nPlataforma: ${os.platform()} ${os.release()}\n\`\`\``);
            return;
        }

        // --- 📜 MEJORA 3: Exportador Raw (!export) ---
        if (textLower === '!export') {
            if (!session) return message.channel.send('❌ No hay sesión activa para exportar.');
            let fullText = '';
            for (let i = 0; i < session.term.buffer.active.length; i++) {
                const line = session.term.buffer.active.getLine(i);
                if (line) fullText += line.translateToString(true).trimRight() + '\n';
            }
            if (!fullText.trim()) return message.channel.send('❌ El historial está vacío.');
            
            const buffer = Buffer.from(stripAnsi(fullText), 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: 'claude_history.txt' });
            await message.channel.send({ content: '📜 **Exportación completa de la memoria visual actual:**', files: [attachment] });
            return;
        }

        // --- 🔌 MEJORA 5: Atajo MCP Menu (!mcp) ---
        if (textLower === '!mcp') {
            if (session) {
                session.ptyProcess.write('/mcp\r');
                await message.channel.send('🔌 **Invocando administrador de MCP de Claude Code.** (Usa los botones/flechas para navegar en el menú que aparecerá).');
            } else {
                await message.channel.send('❌ Requiere una sesión activa de Claude.');
            }
            return;
        }

        // Comando para forzar voz independiente de nota de audio
        if (textLower === '!voice') {
            if (session) {
                session.replyWithVoice = true;
                await message.react('🔊');
            }
            return;
        }

        // Comandos TUI y de control
        if (textLower === '!restart' || textLower === '!stop') {
            if (session) {
                session.destroy();
                activeSessions.delete(sessionId);
            }
            if (textLower === '!restart') {
                session = new ClaudeSession(message.author.id, message.channel);
                activeSessions.set(sessionId, session);
                await message.channel.send('✅ Nueva sesión interactiva de Claude Code iniciada. (El entorno tardará unos segundos en cargar)');
            } else {
                await message.channel.send('✅ Sesión interactiva de Claude Code detenida. Escribe cualquier mensaje para iniciar una nueva.');
            }
            return;
        }

        if (session) {
            // Controles de interrupción de TTY (Ctrl+C)
            if (textLower === '!cancel') {
                session.ptyProcess.write('\x03'); // Enviar señal de interrupción real (SIGINT)
                await message.channel.send('🛑 **Señal de cancelación enviada** (Ctrl+C interceptado). La tarea actual de Claude debe detenerse en breve.');
                return;
            }

            // Controles TUI para navegar por interfaces interactivas de terminal
            if (textLower === '!up') {
                session.ptyProcess.write('\x1B[A');
                return;
            }
            if (textLower === '!down') {
                session.ptyProcess.write('\x1B[B');
                return;
            }
            if (textLower === '!enter') {
                session.ptyProcess.write('\r');
                return;
            }
            // Macro atajo para la pantalla "Yes, I accept" (Baja y presiona Enter)
            if (textLower === 'yes' || textLower === '!yes') {
                session.ptyProcess.write('\x1B[B'); // Abajo
                setTimeout(() => session.ptyProcess.write('\r'), 200); // Enter
                return;
            }
            if (textLower === 'no' || textLower === '!no') {
                session.ptyProcess.write('\r'); // El "No" es la primera opción, solo Enter
                return;
            }
        }

        // Si no hay sesión, iniciar una nueva automáticamente
        if (!session) {
            await message.channel.send('🔌 Iniciando conexión interactiva con Claude Code CLI...\n*Envía `!restart` para reiniciar la consola, o `!stop` para detenerla.*');
            session = new ClaudeSession(message.author.id, message.channel);
            activeSessions.set(sessionId, session);
            
            // Esperar un segundo para enviar el primer mensaje dando tiempo a que Claude cargue
            setTimeout(() => {
                // Fallback de seguridad, a veces al iniciar si solo mandamos archivos Claude no los lee al instante
                session.write(finalInputText || 'Hola');
            }, 2500);
            return;
        }

        // Si la sesión existe, simplemente enviar el texto como input a la terminal
        // Esto previene mandar puros Enters a la terminal al subir imagenes vacías
        if (finalInputText.trim()) {
            session.write(finalInputText);
        }
});

// Manejar interacciones de Botones, Modales y Comandos Slash (/) nativos
client.on('interactionCreate', async (interaction) => {
    // 🛡️ BARRERA DE SEGURIDAD INTERACCIONES
    if (ALLOWED_USER_ID && interaction.user.id !== ALLOWED_USER_ID) {
        return interaction.reply({ content: 'Acceso Denegado Nivel Administrador.', ephemeral: true });
    }

    // 👉 Ruteador de Comandos Ocultos (SLASH COMMANDS!)
    if (interaction.isChatInputCommand()) {
        await interaction.reply({ content: `⏳ Procesando hiper-comando \`/${interaction.commandName}\`...`, ephemeral: true });
        
        let argString = '';
        if (interaction.options.data.length > 0) {
            argString = ' ' + interaction.options.data.map(opt => {
               if (interaction.commandName === 'cron' && opt.name === 'horario') return `"${opt.value}"`; 
               return opt.value;
            }).join(' ');
        }
        
        // Disfrazamos el comando Slash de mensaje clásico y lo reenviamos al sistema maestro `messageCreate`
        const fakeMessage = {
            author: interaction.user,
            channel: interaction.channel,
            guild: interaction.guild,
            content: '!' + interaction.commandName + argString,
            attachments: new Map(),
            react: async () => {} // Evita crasheos de reacts
        };
        client.emit('messageCreate', fakeMessage);
        return;
    }
    
    // Si no es interacción de TUI, Modal o Boton, ignorar
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    // Ignorar interacciones fuera de DM si aplica (aunque en este caso la sesión es por usuario)
    const sessionId = interaction.channel.id;
    let session = activeSessions.get(sessionId);
    
    if (!session && interaction.customId.startsWith('tui_')) {
        return interaction.reply({ content: '❌ No tienes ninguna sesión de consola activa para usar estos botones.', ephemeral: true });
    }

    if (interaction.customId === 'tui_up') {
        session.ptyProcess.write('\x1B[A');
        await interaction.deferUpdate(); // Silencioso
    } else if (interaction.customId === 'tui_down') {
        session.ptyProcess.write('\x1B[B');
        await interaction.deferUpdate();
    } else if (interaction.customId === 'tui_enter') {
        session.ptyProcess.write('\r');
        await interaction.deferUpdate();
        await interaction.editReply({ components: [] }).catch(() => {});
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'explorer_menu') {
        const val = interaction.values[0];
        let currentExpDir = userExplorers.get(sessionId) || process.cwd();
        
        if (val === 'IGNORE') return interaction.deferUpdate();
        
        if (val === 'DIR_UP') {
            const newDir = path.dirname(currentExpDir);
            userExplorers.set(sessionId, newDir);
            await interaction.deferUpdate();
            await sendExplorer(interaction.channel, sessionId, newDir);
            return;
        }
        
        if (val.startsWith('SEL_')) {
            const targetPath = val.substring(4);
            try {
                if (fs.lstatSync(targetPath).isDirectory()) {
                    userExplorers.set(sessionId, targetPath);
                    await interaction.deferUpdate();
                    await sendExplorer(interaction.channel, sessionId, targetPath);
                } else {
                    let targetSession = activeSessions.get(sessionId);
                    const fileContext = `\n\nArchivo físico localizado y enviado a la IA:\n"${targetPath}"\nActúa inmediatamente leyendo esta información como contexto base para lo que haremos después.`;
                    if (targetSession) targetSession.write(fileContext);
                    await interaction.reply({ content: `✅ Archivo fuente \`${path.basename(targetPath)}\` insertado secretamente en la mente de Claude.`, ephemeral: true });
                }
            } catch(e) { }
            return;
        }
    }

    if (interaction.customId === 'exp_mount') {
        const mountPath = userExplorers.get(sessionId) || process.cwd();
        let targetSession = activeSessions.get(sessionId);
        if (targetSession) { targetSession.destroy(); activeSessions.delete(sessionId); }
        targetSession = new ClaudeSession(interaction.user.id, interaction.channel, mountPath);
        activeSessions.set(sessionId, targetSession);
        return interaction.reply({ content: `✅ **AGENTE CLAUDE RELOCALIZADO.** \nHa despertado dentro de: \`${mountPath}\`` });
    }

    // --- GUI: MODAL MEMORIA (CLAUDE.md) ---
    if (interaction.customId === 'btn_open_memory') {
        const targetSession_mem = activeSessions.get(sessionId);
        const cwd = targetSession_mem ? targetSession_mem.currentCwd : process.cwd();
        const mdPath = path.join(cwd, 'CLAUDE.md');
        let currentMemory = '';
        if (fs.existsSync(mdPath)) currentMemory = fs.readFileSync(mdPath, 'utf8');
        
        const modal = new ModalBuilder().setCustomId('modal_memory').setTitle('Memoria Subconsciente (CLAUDE.md)');
        const memoryInput = new TextInputBuilder()
            .setCustomId('memory_text')
            .setLabel('Reglas y Arquitectura Central del Proyecto')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(currentMemory.substring(0, 3999))
            .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(memoryInput));
        return interaction.showModal(modal);
    }
    
    if (interaction.isModalSubmit() && interaction.customId === 'modal_memory') {
        const newMemory = interaction.fields.getTextInputValue('memory_text');
        const targetSession_modal = activeSessions.get(sessionId);
        const cwd = targetSession_modal ? targetSession_modal.currentCwd : process.cwd();
        const mdPath = path.join(cwd, 'CLAUDE.md');
        fs.writeFileSync(mdPath, newMemory);
        await interaction.reply({ content: '✅ **Memoria Actualizada**. Las nuevas leyes centrales están activas en `CLAUDE.md`.', ephemeral: true });
        
        if (targetSession_modal) targetSession_modal.write("Aviso Oculto Del Sistema: El humano ha actualizado drásticamente tus reglas subconscientes globales de CLAUDE.md. Por favor recarga el archivo en tu cerebro e indica Acuse de Recibo listando 1 cambio principal.");
        return;
    }
});

// Cuando el bot esté listo, inyectamos los Slash Commands
client.once('ready', async () => {
    console.log(`✅ Bot conectado e iniciando Fase 4 (Agente Autónomo) como ${client.user.tag}`);
    try {
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        console.log('⏳ Registrando el Arsenal de Slash Commands (/) Globales en Discord...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comandos Autocompletables de Barra Diagonal (/) Registrados Perfectamente.');
    } catch(err) { console.error('❌ Error de registro Slash:', err.message); }
});

// Iniciar el cliente
client.login(BOT_TOKEN).catch((error) => {
    console.error('❌ Error al iniciar sesión:', error);
    process.exit(1);
});