require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Cámbialo en producción

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/files', express.static('uploads'));

// 1. Configuración de Base de Datos (SQLite)
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_filename TEXT,
        original_name TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`INSERT OR IGNORE INTO config (id, active_filename, original_name) VALUES (1, NULL, NULL)`);
});

// 2. Configuración de subida de archivos (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Middleware de autenticación básica para el panel
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['x-admin-password'];
    if (authHeader === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Contraseña incorrecta' });
    }
};

// ==========================================
// RUTA FIJA DEL CÓDIGO QR (Nunca cambia)
// ==========================================
app.get('/ver', (req, res) => {
    db.get('SELECT active_filename FROM config WHERE id = 1', (err, row) => {
        if (err || !row || !row.active_filename) {
            return res.status(404).send('<h1>Aún no hay ningún archivo configurado para este QR.</h1>');
        }

        const filePath = path.join(__dirname, 'uploads', row.active_filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('<h1>El archivo configurado ya no existe en el servidor.</h1>');
        }

        // Sirve el archivo directamente en el navegador (PDF, JPG, PNG, MP4, etc.)
        // Evita caché agresivo para que al escanear siempre traiga el último
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.sendFile(filePath);
    });
});

// ==========================================
// ENDPOINTS DE ADMINISTRACIÓN
// ==========================================

// Obtener estado actual y generar el QR en Base64
app.get('/api/status', async (req, res) => {
    const publicUrl = `${req.protocol}://${req.get('host')}/ver`;
    try {
        const qrImage = await QRCode.toDataURL(publicUrl, { width: 300, margin: 2 });
        db.get('SELECT * FROM config WHERE id = 1', (err, row) => {
            res.json({
                qrUrl: publicUrl,
                qrImage,
                currentFile: row
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error generando QR' });
    }
});

// Subir y activar nuevo archivo
app.post('/api/upload', authMiddleware, upload.single('archivo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se envió ningún archivo' });
    }

    // Opcional: Borrar el archivo anterior para no llenar el disco
    db.get('SELECT active_filename FROM config WHERE id = 1', (err, row) => {
        if (row && row.active_filename) {
            const oldPath = path.join(__dirname, 'uploads', row.active_filename);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        // Actualizar DB con el nuevo archivo
        db.run(
            'UPDATE config SET active_filename = ?, original_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
            [req.file.filename, req.file.originalname],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error actualizando base de datos' });
                res.json({ 
                    message: 'Archivo actualizado exitosamente', 
                    file: req.file.originalname 
                });
            }
        );
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Panel Admin: http://localhost:${PORT}/admin.html`);
    console.log(`Enlace del QR: http://localhost:${PORT}/ver`);
});
