const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Variables globales para almacenar datos
let sensorData = {
    temperature: 0,
    humidity: 0,
    timestamp: Date.now(),
    device_id: 'ESP32_001'
};

let commandQueue = {
    servo_activate: false
};

let sensorHistory = [];
const MAX_HISTORY = 100;

// Archivo de configuración
const CONFIG_FILE = path.join(__dirname, 'feeding-config.json');

// Cargar configuración al inicio
let feedingConfig = loadConfig();

// Endpoint para recibir datos del sensor desde ESP32
app.post('/api/sensor-data', (req, res) => {
    try {
        const { temperature, humidity, timestamp, device_id } = req.body;
        
        // Actualizar datos actuales
        sensorData = {
            temperature: parseFloat(temperature),
            humidity: parseFloat(humidity),
            timestamp: Date.now(),
            device_id: device_id || 'ESP32_001'
        };
        
        // Agregar al historial
        sensorHistory.push({
            ...sensorData,
            receivedAt: new Date().toISOString()
        });
        
        // Mantener solo los últimos registros
        if (sensorHistory.length > MAX_HISTORY) {
            sensorHistory = sensorHistory.slice(-MAX_HISTORY);
        }
        
        console.log(`📊 Datos recibidos - Temp: ${temperature}°C, Humedad: ${humidity}%`);
        
        res.json({
            status: 'success',
            message: 'Datos recibidos correctamente',
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Error procesando datos del sensor:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para que ESP32 verifique comandos pendientes
app.get('/api/commands', (req, res) => {
    try {
        res.json(commandQueue);
        
        // Resetear comandos después de enviarlos
        commandQueue.servo_activate = false;
        
    } catch (error) {
        console.error('Error enviando comandos:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para confirmar ejecución de comandos
app.post('/api/command-executed', (req, res) => {
    try {
        const { command, status } = req.body;
        console.log(`✅ Comando ejecutado: ${command} - Estado: ${status}`);
        
        res.json({
            status: 'success',
            message: 'Confirmación recibida'
        });
        
    } catch (error) {
        console.error('Error procesando confirmación:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para la interfaz web - obtener datos actuales
app.get('/api/current-data', (req, res) => {
    try {
        const timeDiff = Date.now() - sensorData.timestamp;
        const isOnline = timeDiff < 10000; // Considerar online si los datos son de menos de 10 segundos
        
        res.json({
            ...sensorData,
            isOnline,
            lastUpdate: new Date(sensorData.timestamp).toLocaleString()
        });
        
    } catch (error) {
        console.error('Error obteniendo datos actuales:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para activar servo desde la interfaz web
app.post('/api/activate-servo', (req, res) => {
    try {
        commandQueue.servo_activate = true;
        console.log('🎯 Comando de servo activado desde interfaz web');
        
        res.json({
            status: 'success',
            message: 'Comando enviado al ESP32'
        });
        
    } catch (error) {
        console.error('Error activando servo:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});


// Endpoint para obtener historial de datos
app.get('/api/history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const recentHistory = sensorHistory.slice(-limit);
        
        res.json(recentHistory);
        
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para agregar horario de comida
app.post('/api/add-feeding-time', (req, res) => {
    try {
        const { feedingTime } = req.body;
        
        if (!feedingTime) {
            return res.status(400).json({
                status: 'error',
                message: 'Horario de comida requerido'
            });
        }
        
        // Validar formato de hora
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(feedingTime)) {
            return res.status(400).json({
                status: 'error',
                message: 'Formato de hora inválido'
            });
        }
        
        // Inicializar array si no existe (migración de versión anterior)
        if (!feedingConfig.feedingTimes) {
            feedingConfig.feedingTimes = feedingConfig.feedingTime ? [feedingConfig.feedingTime] : [];
        }
        
        // Verificar si ya existe el horario
        if (feedingConfig.feedingTimes.includes(feedingTime)) {
            return res.status(400).json({
                status: 'error',
                message: 'Este horario ya está configurado'
            });
        }
        
        feedingConfig.feedingTimes.push(feedingTime);
        feedingConfig.feedingTimes.sort(); // Ordenar horarios
        feedingConfig.lastUpdated = getPeruTime().toISOString();
        
        saveConfig(feedingConfig);
        
        console.log(`⏰ Horario de comida agregado: ${feedingTime} (Hora Perú GMT-5)`);
        
        res.json({
            status: 'success',
            message: 'Horario agregado correctamente',
            feedingTimes: feedingConfig.feedingTimes
        });
        
    } catch (error) {
        console.error('Error guardando horario:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para eliminar horario de comida
app.delete('/api/remove-feeding-time', (req, res) => {
    try {
        const { feedingTime } = req.body;
        
        if (!feedingTime) {
            return res.status(400).json({
                status: 'error',
                message: 'Horario de comida requerido'
            });
        }
        
        // Inicializar array si no existe
        if (!feedingConfig.feedingTimes) {
            feedingConfig.feedingTimes = [];
        }
        
        const index = feedingConfig.feedingTimes.indexOf(feedingTime);
        if (index === -1) {
            return res.status(404).json({
                status: 'error',
                message: 'Horario no encontrado'
            });
        }
        
        feedingConfig.feedingTimes.splice(index, 1);
        feedingConfig.lastUpdated = getPeruTime().toISOString();
        
        saveConfig(feedingConfig);
        
        console.log(`🗑️ Horario de comida eliminado: ${feedingTime} (Hora Perú GMT-5)`);
        
        res.json({
            status: 'success',
            message: 'Horario eliminado correctamente',
            feedingTimes: feedingConfig.feedingTimes
        });
        
    } catch (error) {
        console.error('Error eliminando horario:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para obtener configuración de comida
app.get('/api/feeding-config', (req, res) => {
    try {
        // Migrar de versión anterior si es necesario
        if (!feedingConfig.feedingTimes && feedingConfig.feedingTime) {
            feedingConfig.feedingTimes = [feedingConfig.feedingTime];
            delete feedingConfig.feedingTime;
            saveConfig(feedingConfig);
        }
        
        res.json(feedingConfig);
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor'
        });
    }
});

// Función para obtener hora peruana (GMT-5)
function getPeruTime() {
    const now = new Date();
    return new Date(now.toLocaleString("en-US", {timeZone: "America/Lima"}));
}

// Funciones para manejar configuración JSON
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error cargando configuración:', error);
    }
    
    // Configuración por defecto
    return {
        feedingTimes: ['08:00'],
        lastUpdated: getPeruTime().toISOString()
    };
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('✅ Configuración guardada en:', CONFIG_FILE);
    } catch (error) {
        console.error('Error guardando configuración:', error);
        throw error;
    }
}

// Servir la interfaz web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Servidor IoT iniciado');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 Interfaz web: http://localhost:${PORT}`);
    console.log(`📊 API endpoints disponibles:`);
    console.log(`   POST /api/sensor-data - Recibir datos del ESP32`);
    console.log(`   GET  /api/commands - ESP32 verifica comandos`);
    console.log(`   POST /api/command-executed - Confirmar ejecución`);
    console.log(`   GET  /api/current-data - Datos actuales para interfaz web`);
    console.log(`   POST /api/activate-servo - Activar servo desde web`);
    console.log(`   GET  /api/history - Historial de datos`);
    console.log(`   POST /api/add-feeding-time - Agregar horario de comida`);
    console.log(`   DELETE /api/remove-feeding-time - Eliminar horario de comida`);
    console.log(`   GET  /api/feeding-config - Obtener configuración`);
    console.log('');
    
    // Migrar configuración si es necesario
    if (!feedingConfig.feedingTimes && feedingConfig.feedingTime) {
        feedingConfig.feedingTimes = [feedingConfig.feedingTime];
        delete feedingConfig.feedingTime;
        saveConfig(feedingConfig);
    }
    
    console.log(`⏰ Horarios de comida actuales: ${feedingConfig.feedingTimes ? feedingConfig.feedingTimes.join(', ') : 'Ninguno'} (Hora Perú GMT-5)`);
    console.log(`🕐 Hora actual del servidor: ${getPeruTime().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`);
    console.log('💡 Recuerda cambiar la IP en esp32_client.ino por tu IP local');
});