const ytdl = require('ytdl-core');
const { v4: uuidv4 } = require('uuid');

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        const { videoUrl, format, quality } = req.body;

        if (!videoUrl) {
            return res.status(400).json({ error: 'URL YouTube manquante' });
        }

        if (!ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ error: 'URL YouTube invalide' });
        }

        try {
            const info = await ytdl.getInfo(videoUrl);
            const title = info.videoDetails.title.replace(/[^\w\s\-\.]/gi, '');
            const outputFileName = `${title}.${format}`;

            // Pour Vercel, nous ne pouvons pas directement télécharger et convertir des fichiers sur le serveur.
            // Il faudrait une solution de stockage cloud (ex: AWS S3) et un service de conversion externe (ex: Transloadit, ou une autre fonction serverless dédiée à la conversion).
            // Pour cette démonstration gratuite, nous allons simuler le processus et renvoyer un lien de téléchargement fictif.
            // Dans un cas réel, le client devrait initier le téléchargement directement depuis ytdl-core ou via un service tiers.

            // Simuler un lien de téléchargement
            const simulatedDownloadLink = `https://example.com/downloads/${outputFileName}`;

            res.status(200).json({
                id: uuidv4(),
                filename: outputFileName,
                downloadLink: simulatedDownloadLink,
                message: 'Le téléchargement et la conversion seraient gérés par un service externe ou un stockage cloud dans un environnement de production sans serveur.'
            });

        } catch (error) {
            console.error('Erreur de traitement:', error);
            res.status(500).json({ error: error.message || 'Erreur lors du traitement de la demande' });
        }
    } else {
        res.status(405).json({ error: 'Méthode non autorisée' });
    }
};

