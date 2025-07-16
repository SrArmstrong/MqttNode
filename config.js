module.exports = {
    // Configuración del broker MQTT
    mqtt: {
        // Dirección del broker MQTT con SSL/TLS
        broker: 'mqtts://l46d1e5e.ala.us-east-1.emqxsl.com:8883',
        
        // Credenciales de autenticación
        username: 'big-data-001',
        password: '1Q2W3E4R5T6Y',
        
        // ID único del cliente (importante para identificación)
        clientId: `mqtt_client_${Math.random().toString(16).substr(2, 8)}`,
        
        // Configuración de conexión
        keepalive: 60,          // Tiempo de vida de la conexión (segundos)
        connectTimeout: 30000,  // Timeout de conexión (ms)
        reconnectPeriod: 1000,  // Periodo de reconexión (ms)
        
        // Configuración SSL/TLS
        rejectUnauthorized: false, // Para certificados autofirmados
        
        // Configuración de Quality of Service
        qos: 1 // 0: At most once, 1: At least once, 2: Exactly once
    },
    
    // Configuración de logging
    logging: {
        level: 'info', // debug, info, warn, error
        format: 'YYYY-MM-DD HH:mm:ss'
    }
};