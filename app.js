const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Server } = require('socket.io');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// File d'attente pour gérer les téléchargements
const downloadQueue = [];
const activeDownloads = new Map();
let isProcessing = false;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Fonction pour traiter la file d'attente
async function processQueue() {
    if (isProcessing || downloadQueue.length === 0) return;
    
    isProcessing = true;
    
    while (downloadQueue.length > 0) {
        const downloadTask = downloadQueue.shift();
        await processDownload(downloadTask);
    }
    
    isProcessing = false;
}

// Fonction pour traiter un téléchargement
async function processDownload({ id, videoUrl, format, quality, socketId }) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    try {
        // Validation de l'URL
        if (!ytdl.validateURL(videoUrl)) {
            socket.emit('downloadError', { id, error: 'URL YouTube invalide' });
            return;
        }

        socket.emit('downloadProgress', { id, progress: 10, status: 'Récupération des informations...' });

        const info = await ytdl.getInfo(videoUrl);
        const title = info.videoDetails.title.replace(/[^\w\s\-\.]/gi, '');
        const outputFileName = `${title}.${format}`;

        socket.emit('downloadProgress', { id, progress: 20, status: 'Début du téléchargement...' });

        if (format === 'mp3') {
            await downloadAudio(id, videoUrl, outputFileName, socket);
        } else {
            await downloadVideo(id, videoUrl, quality, outputFileName, socket);
        }

    } catch (error) {
        console.error('Erreur de téléchargement:', error);
        socket.emit('downloadError', { 
            id, 
            error: error.message || 'Erreur lors du téléchargement' 
        });
    }
}

// Fonction pour télécharger l'audio
async function downloadAudio(id, videoUrl, outputFileName, socket) {
    return new Promise((resolve, reject) => {
        const tempPath = path.join(__dirname, 'temp', `${id}.mp4`);
        const outputPath = path.join(__dirname, 'downloads', outputFileName);
        
        // Créer les dossiers s'ils n'existent pas
        if (!fs.existsSync(path.dirname(tempPath))) {
            fs.mkdirSync(path.dirname(tempPath), { recursive: true });
        }
        if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        }

        const audio = ytdl(videoUrl, { quality: 'highestaudio' });
        let downloadedBytes = 0;
        let totalBytes = 0;

        audio.on('response', (res) => {
            totalBytes = parseInt(res.headers['content-length']);
        });

        audio.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
                const progress = Math.round((downloadedBytes / totalBytes) * 50) + 20; // 20-70%
                socket.emit('downloadProgress', { 
                    id, 
                    progress, 
                    status: 'Téléchargement audio...' 
                });
            }
        });

        const writeStream = fs.createWriteStream(tempPath);
        audio.pipe(writeStream);

        writeStream.on('finish', () => {
            socket.emit('downloadProgress', { id, progress: 70, status: 'Conversion en MP3...' });
            
            ffmpeg(tempPath)
                .audioBitrate(128)
                .format('mp3')
                .on('progress', (progress) => {
                    const convertProgress = Math.round(progress.percent * 0.25) + 70; // 70-95%
                    socket.emit('downloadProgress', { 
                        id, 
                        progress: convertProgress, 
                        status: 'Conversion en cours...' 
                    });
                })
                .on('end', () => {
                    // Nettoyer le fichier temporaire
                    fs.unlinkSync(tempPath);
                    
                    socket.emit('downloadComplete', { 
                        id, 
                        filename: outputFileName,
                        path: outputPath
                    });
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Erreur FFmpeg:', err);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    reject(err);
                })
                .save(outputPath);
        });

        writeStream.on('error', reject);
        audio.on('error', reject);
    });
}

// Fonction pour télécharger la vidéo
async function downloadVideo(id, videoUrl, quality, outputFileName, socket) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(__dirname, 'downloads', outputFileName);
        
        if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        }

        const video = ytdl(videoUrl, {
            quality: quality,
            filter: 'audioandvideo'
        });

        let downloadedBytes = 0;
        let totalBytes = 0;

        video.on('response', (res) => {
            totalBytes = parseInt(res.headers['content-length']);
        });

        video.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
                const progress = Math.round((downloadedBytes / totalBytes) * 75) + 20; // 20-95%
                socket.emit('downloadProgress', { 
                    id, 
                    progress, 
                    status: 'Téléchargement vidéo...' 
                });
            }
        });

        const writeStream = fs.createWriteStream(outputPath);
        video.pipe(writeStream);

        writeStream.on('finish', () => {
            socket.emit('downloadComplete', { 
                id, 
                filename: outputFileName,
                path: outputPath
            });
            resolve();
        });

        writeStream.on('error', reject);
        video.on('error', reject);
    });
}

// Route pour télécharger un fichier
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'downloads', filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Erreur de téléchargement:', err);
                res.status(500).send('Erreur lors du téléchargement du fichier');
            }
        });
    } else {
        res.status(404).send('Fichier non trouvé');
    }
});

// Gestion des connexions WebSocket
io.on('connection', (socket) => {
    console.log('Client connecté:', socket.id);

    socket.on('startDownload', (data) => {
        const { videoUrl, format, quality } = data;
        const downloadId = uuidv4();
        
        // Ajouter à la file d'attente
        downloadQueue.push({
            id: downloadId,
            videoUrl,
            format,
            quality,
            socketId: socket.id
        });

        // Informer le client que le téléchargement est en file d'attente
        socket.emit('downloadQueued', { 
            id: downloadId, 
            position: downloadQueue.length 
        });

        // Traiter la file d'attente
        processQueue();
    });

    socket.on('disconnect', () => {
        console.log('Client déconnecté:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Serveur en écoute sur http://localhost:${PORT}`);
});