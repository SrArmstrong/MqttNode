const mqtt = require('mqtt');
const winston = require('winston');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Clase principal para el cliente MQTT
 * Maneja la conexión, suscripción y procesamiento de mensajes
 */
class MQTTClient {

    constructor() {
        // Cliente MQTT (se inicializa en setupClient)
        this.client = null;

        // Configurar el sistema de logging
        this.setupLogger();

        // Contador de mensajes recibidos
        this.messageCount = 0;

        // Configurar el cliente MQTT
        this.setupClient();
    }

    setupLogger() {
        this.logger = winston.createLogger({
            level: config.logging.level,
            format: winston.format.combine(
                winston.format.timestamp({
                    format: config.logging.format
                }),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.printf(({ timestamp, level, message, stack }) => {
                    return `${timestamp} [${level.toUpperCase()}] ${message}${stack ? '\n' + stack : ''}`;
                })
            ),
            transports: [
                // Logging a consola con colores
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                // Logging a archivo para errores
                new winston.transports.File({ 
                    filename: 'mqtt-client.log',
                    level: 'error'
                })
            ]
        });
    }

    setupClient() {
        this.logger.info('🔧 Configurando cliente MQTT...');
        
        // Opciones de conexión del cliente MQTT
        const options = {
            // Credenciales de autenticación
            username: config.mqtt.username,
            password: config.mqtt.password,
            
            // Identificación del cliente
            clientId: config.mqtt.clientId,
            
            // Configuración de conexión
            keepalive: config.mqtt.keepalive,
            connectTimeout: config.mqtt.connectTimeout,
            reconnectPeriod: config.mqtt.reconnectPeriod,
            
            // Configuración SSL/TLS
            rejectUnauthorized: config.mqtt.rejectUnauthorized,
            
            // Limpiar sesión al conectar
            clean: true,
            
            // Will message (mensaje que se envía si el cliente se desconecta inesperadamente)
            will: {
                topic: 'clients/disconnect',
                payload: JSON.stringify({
                    clientId: config.mqtt.clientId,
                    timestamp: new Date().toISOString(),
                    message: 'Cliente desconectado inesperadamente'
                }),
                qos: 1,
                retain: false
            }
        };

        // Configurar certificado CA si existe
        this.setupCertificate(options);
        
        // Crear cliente MQTT
        try {
            this.client = mqtt.connect(config.mqtt.broker, options);
            this.logger.info(`✅ Cliente MQTT creado - ID: ${config.mqtt.clientId}`);
            
            // Configurar event listeners
            this.setupEventListeners();
            
        } catch (error) {
            this.logger.error('❌ Error creando cliente MQTT:', error);
            throw error;
        }
    }

    /**
     * Configura certificado CA si está disponible
     * @param {Object} options - Opciones del cliente MQTT
     */
    setupCertificate(options) {
        const certPath = path.join(__dirname, 'certificates', 'emqxsl_ca.pem');
        
        // Verificar si existe el certificado
        if (fs.existsSync(certPath)) {
            try {
                // Leer el certificado CA
                const caCert = fs.readFileSync(certPath);
                options.ca = [caCert];
                options.rejectUnauthorized = true; // Habilitar verificación con CA
                
                this.logger.info('🔐 Certificado CA configurado correctamente');
            } catch (error) {
                this.logger.warn('⚠️ Error leyendo certificado CA, usando SSL básico:', error.message);
            }
        } else {
            this.logger.info('🔓 Certificado CA no encontrado, usando SSL básico');
        }
    }

    setupEventListeners() {
        // Evento: Conexión exitosa
        this.client.on('connect', (connack) => {
            this.onConnect(connack);
        });

        // Evento: Mensaje recibido
        this.client.on('message', (topic, message, packet) => {
            this.onMessage(topic, message, packet);
        });

        // Evento: Error de conexión
        this.client.on('error', (error) => {
            this.onError(error);
        });

        // Evento: Desconexión
        this.client.on('disconnect', (packet) => {
            this.onDisconnect(packet);
        });

        // Evento: Conexión perdida
        this.client.on('offline', () => {
            this.onOffline();
        });

        // Evento: Reconexión
        this.client.on('reconnect', () => {
            this.onReconnect();
        });

        // Evento: Fin de conexión
        this.client.on('end', () => {
            this.onEnd();
        });
    }

    /**
     * Maneja el evento de conexión exitosa
     * @param {Object} connack - Información de confirmación de conexión
     */
    onConnect(connack) {
        this.logger.info('🎉 ¡Conectado exitosamente al broker MQTT!');
        this.logger.info(`🔌 Broker: ${config.mqtt.broker}`);
        this.logger.info(`👤 Usuario: ${config.mqtt.username}`);
        this.logger.info(`🆔 Client ID: ${config.mqtt.clientId}`);
        
        // Log de información de la sesión
        if (connack.sessionPresent) {
            this.logger.info('📋 Sesión anterior restaurada');
        } else {
            this.logger.info('🆕 Nueva sesión iniciada');
        }

        // Suscribirse a todos los tópicos
        this.subscribeToAllTopics();
    }

    /**
     * Suscribe el cliente a todos los tópicos usando wildcard
     */
    subscribeToAllTopics() {
        const wildcardTopic = '/#'; // # = todos los tópicos
        
        this.client.subscribe(wildcardTopic, { qos: config.mqtt.qos }, (error, granted) => {
            if (error) {
                this.logger.error('❌ Error suscribiéndose a tópicos:', error);
                return;
            }

            // Log de suscripciones exitosas
            granted.forEach((subscription) => {
                this.logger.info(`📡 Suscrito a: ${subscription.topic} (QoS: ${subscription.qos})`);
            });

            this.logger.info('🎯 ¡Listo para recibir mensajes de todos los tópicos!');
        });
    }

    /**
     * Maneja los mensajes MQTT recibidos
     * @param {String} topic - Tópico del mensaje
     * @param {Buffer} message - Contenido del mensaje
     * @param {Object} packet - Información completa del paquete MQTT
     */
    onMessage(topic, message, packet) {
        try {
            // Incrementar contador de mensajes
            this.messageCount++;
            
            // Convertir mensaje de Buffer a string
            const messageString = message.toString();
            
            // Timestamp del mensaje
            const timestamp = moment().format(config.logging.format);
            
            // Log básico del mensaje recibido
            this.logger.info(`📨 Mensaje #${this.messageCount} recibido`);
            this.logger.info(`   📍 Tópico: ${topic}`);
            this.logger.info(`   🕐 Timestamp: ${timestamp}`);
            this.logger.info(`   📏 Tamaño: ${message.length} bytes`);
            this.logger.info(`   🎯 QoS: ${packet.qos}`);
            this.logger.info(`   🔄 Retain: ${packet.retain ? 'Sí' : 'No'}`);
            this.logger.info(`   🆔 Message ID: ${packet.messageId || 'N/A'}`);

            // Procesar el contenido del mensaje
            this.processMessage(topic, messageString, timestamp);
            
            // Separador visual para mejor legibilidad
            console.log('─'.repeat(80));
            
        } catch (error) {
            this.logger.error('❌ Error procesando mensaje:', error);
        }
    }

    /**
     * Procesa y formatea el contenido del mensaje recibido
     * @param {String} topic - Tópico del mensaje
     * @param {String} message - Contenido del mensaje
     * @param {String} timestamp - Timestamp del mensaje
     */
    processMessage(topic, message, timestamp) {
        try {
            // Intentar parsear como JSON
            const jsonData = JSON.parse(message);
            
            this.logger.info('   📋 Tipo: JSON válido');
            this.logger.info('   📄 Contenido JSON:');
            
            // Mostrar JSON formateado con indentación
            const formattedJson = JSON.stringify(jsonData, null, 2);
            console.log('\x1b[36m%s\x1b[0m', formattedJson); // Cyan color
            
            // Si el JSON tiene campos específicos, mostrarlos
            this.analyzeJsonContent(jsonData);
            
        } catch (jsonError) {
            // No es JSON válido, tratar como texto plano
            this.logger.info('   📋 Tipo: Texto plano');
            this.logger.info('   📄 Contenido:');
            console.log('\x1b[33m%s\x1b[0m', message); // Yellow color
            
            // Analizar si contiene datos numéricos
            this.analyzeTextContent(message);
        }
    }

    /**
     * Analiza y extrae información relevante de contenido JSON
     * @param {Object} jsonData - Datos JSON parseados
     */
    analyzeJsonContent(jsonData) {
        // Contar propiedades del objeto
        const propertyCount = Object.keys(jsonData).length;
        this.logger.info(`   🔍 Propiedades encontradas: ${propertyCount}`);
        
        // Buscar campos comunes en IoT
        const commonFields = ['temperature', 'humidity', 'pressure', 'timestamp', 'device_id', 'sensor_id'];
        const foundFields = commonFields.filter(field => jsonData.hasOwnProperty(field));
        
        if (foundFields.length > 0) {
            this.logger.info(`   🌡️ Campos IoT detectados: ${foundFields.join(', ')}`);
        }
        
        // Mostrar valores numéricos si existen
        Object.entries(jsonData).forEach(([key, value]) => {
            if (typeof value === 'number') {
                this.logger.info(`   📊 ${key}: ${value}`);
            }
        });
    }

    /**
     * Analiza contenido de texto plano buscando patrones
     * @param {String} text - Texto a analizar
     */
    analyzeTextContent(text) {
        // Buscar números en el texto
        const numbers = text.match(/\d+\.?\d*/g);
        if (numbers) {
            this.logger.info(`   🔢 Números encontrados: ${numbers.join(', ')}`);
        }
        
        // Detectar si parece ser un comando
        if (text.startsWith('/') || text.includes('cmd:')) {
            this.logger.info('   ⚡ Posible comando detectado');
        }
        
        // Detectar URLs
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex);
        if (urls) {
            this.logger.info(`   🔗 URLs encontradas: ${urls.length}`);
        }
    }

    /**
     * Maneja errores de conexión MQTT
     * @param {Error} error - Objeto de error
     */
    onError(error) {
        this.logger.error('❌ Error MQTT:', error.message);
        
        // Analizar tipo de error común
        if (error.code === 'ENOTFOUND') {
            this.logger.error('🌐 Error de DNS: No se puede resolver el hostname del broker');
        } else if (error.code === 'ECONNREFUSED') {
            this.logger.error('🔌 Error de conexión: El broker rechazó la conexión');
        } else if (error.code === 'ETIMEDOUT') {
            this.logger.error('⏰ Error de timeout: La conexión tardó demasiado');
        }
    }

    /**
     * Maneja el evento de desconexión
     * @param {Object} packet - Información del paquete de desconexión
     */
    onDisconnect(packet) {
        this.logger.warn('⚠️ Desconectado del broker MQTT');
        if (packet && packet.reasonCode) {
            this.logger.warn(`   🔍 Código de razón: ${packet.reasonCode}`);
        }
    }

    /**
     * Maneja el evento offline (sin conexión)
     */
    onOffline() {
        this.logger.warn('📴 Cliente MQTT offline - Sin conexión al broker');
    }

    /**
     * Maneja el evento de reconexión
     */
    onReconnect() {
        this.logger.info('🔄 Intentando reconectar al broker MQTT...');
    }

    /**
     * Maneja el evento de fin de conexión
     */
    onEnd() {
        this.logger.info('🏁 Conexión MQTT terminada');
        this.logger.info(`📊 Total de mensajes recibidos: ${this.messageCount}`);
    }

    /**
     * Publica un mensaje de prueba (opcional)
     * @param {String} topic - Tópico donde publicar
     * @param {String} message - Mensaje a publicar
     */
    publishTestMessage(topic = 'test/nodejs-client', message = null) {
        if (!this.client || !this.client.connected) {
            this.logger.error('❌ Cliente no conectado. No se puede publicar mensaje.');
            return;
        }

        const testMessage = message || JSON.stringify({
            timestamp: new Date().toISOString(),
            clientId: config.mqtt.clientId,
            messageCount: this.messageCount,
            status: 'active'
        });

        this.client.publish(topic, testMessage, { qos: config.mqtt.qos }, (error) => {
            if (error) {
                this.logger.error('❌ Error publicando mensaje de prueba:', error);
            } else {
                this.logger.info(`✅ Mensaje de prueba publicado en: ${topic}`);
            }
        });
    }

    /**
     * Cierra la conexión MQTT de forma elegante
     */
    disconnect() {
        if (this.client) {
            this.logger.info('🛑 Cerrando conexión MQTT...');
            this.client.end(false, () => {
                this.logger.info('👋 Cliente MQTT desconectado correctamente');
            });
        }
    }

    /**
     * Obtiene estadísticas del cliente
     */
    getStats() {
        return {
            messageCount: this.messageCount,
            clientId: config.mqtt.clientId,
            connected: this.client ? this.client.connected : false,
            broker: config.mqtt.broker
        };
    }
    // Métodos adicionales aquí...
}

/**
 * Función principal que inicializa y ejecuta el cliente MQTT
 */
async function main() {
    console.log('🚀 Iniciando cliente MQTT Node.js...');
    console.log('─'.repeat(50));
    
    try {
        // Crear instancia del cliente MQTT
        const mqttClient = new MQTTClient();
        
        // Manejo de señales del sistema para cierre elegante
        process.on('SIGINT', () => {
            console.log('\n🛑 Señal de interrupción recibida (Ctrl+C)');
            
            // Mostrar estadísticas finales
            const stats = mqttClient.getStats();
            console.log('📊 Estadísticas finales:');
            console.log(`   📨 Mensajes recibidos: ${stats.messageCount}`);
            console.log(`   🆔 Client ID: ${stats.clientId}`);
            console.log(`   🔌 Estado: ${stats.connected ? 'Conectado' : 'Desconectado'}`);
            
            // Desconectar y salir
            mqttClient.disconnect();
            
            setTimeout(() => {
                console.log('👋 ¡Hasta luego!');
                process.exit(0);
            }, 1000);
        });

        // Opcional: Publicar mensaje de prueba después de 5 segundos
        setTimeout(() => {
            mqttClient.publishTestMessage();
        }, 5000);
        
    } catch (error) {
        console.error('💥 Error fatal iniciando el cliente:', error);
        process.exit(1);
    }
}

// Ejecutar función principal si este archivo se ejecuta directamente
if (require.main === module) {
    main();
}

// Exportar la clase para uso en otros módulos
module.exports = MQTTClient;