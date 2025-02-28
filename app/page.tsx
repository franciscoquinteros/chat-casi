'use client';

import React, { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

let socket: Socket;

interface Message {
  id?: string;
  userId?: string;
  message: string;
  sender: string;
  agentId?: string | null;
  timestamp: string;
  conversationId?: string;
  // Campo local para tracking
  _localId?: string;
}

interface Conversation {
  id: string;
  userId: string;
  status: string;
}

interface MessageResponse {
  success: boolean;
  message?: string;
  data?: {
    messageId?: string;
    [key: string]: any;
  };
}

interface ChatProps {
  chatId: string; // El userId del cliente
}

const ChatCliente: React.FC<ChatProps> = ({ chatId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Conectando al chat...');
  const [socketId, setSocketId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketInitialized = useRef(false);
  const conversationCreated = useRef(false);
  const lastSentMessageId = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Inicializar el socket solo una vez
  useEffect(() => {
    if (!socketInitialized.current) {
      console.log('Inicializando socket...');
      socket = io('https://backoffice-casino-back-production.up.railway.app', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        timeout: 10000,
        forceNew: true,
      });
      socketInitialized.current = true;
    }
    
    return () => {
      // No desconectamos el socket aquí para mantener la conexión
    };
  }, []);

  // Configurar los event listeners del socket
  useEffect(() => {
    if (!socket) return;
    
    console.log('Configurando event listeners del socket...');

    // Función para manejar la conexión
    const handleConnect = () => {
      console.log('Cliente conectado al servidor WebSocket');
      console.log('Socket ID:', socket.id);
      setSocketId(socket.id || null);
      setIsConnected(true);
      setConnectionStatus('Conectado');
      
      // Unirse al chat como usuario
      socket.emit('joinChat', { userId: chatId });
      console.log(`Cliente ${chatId} se unió al chat con socket ID ${socket.id}`);
      
      // No creamos la conversación aquí, esperamos al evento userConversations
    };

    // Función para crear una conversación para el usuario
    const createConversation = () => {
      // Evitar crear múltiples conversaciones
      if (conversationCreated.current) {
        console.log('Ya se ha creado una conversación, no se creará otra');
        return;
      }
      
      console.log('Solicitando crear una conversación...');
      // Enviar solicitud HTTP para crear una conversación
      fetch('https://backoffice-casino-back-production.up.railway.app/chat/start-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: chatId }),
      })
        .then(response => response.json())
        .then(data => {
          console.log('Conversación creada:', data);
          if (data.data && data.data.conversationId) {
            setActiveConversation(data.data.conversationId);
            console.log('ID de conversación activa:', data.data.conversationId);
            
            // Marcar que ya se ha creado una conversación
            conversationCreated.current = true;
            
            // Solicitar el historial de mensajes de esta conversación
            socket.emit('getMessages', { conversationId: data.data.conversationId });
          }
        })
        .catch(error => {
          console.error('Error al crear conversación:', error);
        });
    };

    // Función para manejar errores de conexión
    const handleConnectError = (err: Error) => {
      console.error('Error de conexión WebSocket en cliente:', err.message);
      setIsConnected(false);
      setConnectionStatus(`Error de conexión: ${err.message}. Intentando reconectar...`);
    };

    // Función para manejar desconexiones
    const handleDisconnect = (reason: string) => {
      console.log('Cliente desconectado del servidor WebSocket. Razón:', reason);
      setIsConnected(false);
      setConnectionStatus(`Desconectado: ${reason}. Intentando reconectar...`);
    };

    // Función para manejar mensajes nuevos
    const handleNewMessage = (message: Message) => {
      console.log('Nuevo mensaje recibido:', message);
      
      // Si el mensaje es del mismo usuario y tiene el mismo contenido que el último mensaje enviado,
      // podría ser un duplicado enviado por el servidor
      if (lastSentMessageId.current && message.message === lastSentMessageId.current) {
        console.log('Mensaje duplicado detectado, ignorando:', message);
        // Actualizamos lastSentMessageId para evitar futuras confusiones
        lastSentMessageId.current = null;
        return;
      }
      
      setMessages((prev) => {
        // Verificar si el mensaje ya existe en el array para evitar duplicados
        const isDuplicate = prev.some(
          (msg) => 
            msg.message === message.message && 
            msg.sender === message.sender &&
            Math.abs(new Date(msg.timestamp).getTime() - new Date(message.timestamp).getTime()) < 3000 // 3 segundos de margen
        );
        
        if (isDuplicate) {
          console.log('Mensaje duplicado detectado, no se añadirá a la UI:', message);
          return prev;
        }
        
        return [...prev, message];
      });
      
      scrollToBottom();
    };

    // Función para manejar el historial de mensajes
    const handleMessageHistory = (messages: Message[]) => {
      console.log('Historial de mensajes recibido:', messages);
      setMessages(Array.isArray(messages) ? messages : []);
      scrollToBottom();
    };

    // Función para manejar las conversaciones del usuario
    const handleUserConversations = (conversations: Conversation[]) => {
      console.log('Conversaciones del usuario recibidas:', conversations);
      if (conversations && conversations.length > 0) {
        // Usar la primera conversación activa
        const activeConv = conversations.find(conv => conv.status === 'active');
        if (activeConv) {
          setActiveConversation(activeConv.id);
          conversationCreated.current = true; // Marcar que ya tenemos una conversación
          console.log('ID de conversación activa establecida:', activeConv.id);
        } else {
          // Si no hay conversaciones activas, crear una nueva
          createConversation();
        }
      } else {
        // Si no hay conversaciones, crear una nueva
        createConversation();
      }
    };

    // Registrar los event listeners
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('message', handleNewMessage);
    socket.on('newMessage', handleNewMessage);
    socket.on('messageHistory', handleMessageHistory);
    socket.on('userConversations', handleUserConversations);

    // Evento personalizado para depuración
    socket.on('error', (error: Error) => {
      console.error('Error en el socket:', error);
      setConnectionStatus(`Error en el socket: ${error.message || 'Desconocido'}`);
    });

    // Limpiar los event listeners al desmontar
    return () => {
      console.log('Limpiando event listeners...');
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
      socket.off('message', handleNewMessage);
      socket.off('newMessage', handleNewMessage);
      socket.off('messageHistory', handleMessageHistory);
      socket.off('userConversations', handleUserConversations);
      socket.off('error');
    };
  }, [chatId]);

  const sendMessage = () => {
    if (!input.trim() || !isConnected) return;
    
    console.log(`Enviando mensaje desde ${chatId} con socket ID ${socketId}: ${input}`);
    
    // Si no tenemos una conversación activa, cancelamos el envío
    if (!activeConversation) {
      console.error('No hay una conversación activa, no se puede enviar el mensaje');
      setConnectionStatus('Error: No hay una conversación activa');
      return;
    }
    
    // Guardar el contenido del mensaje para verificar duplicados después
    lastSentMessageId.current = input;
    
    // Crear un objeto de mensaje para enviar al servidor
    const messageData = {
      userId: chatId,
      message: input,
      conversationId: activeConversation
    };
    
    console.log('Enviando mensaje con datos:', messageData);
    
    // Enviar mensaje al servidor
    socket.emit('clientMessage', messageData, (response: MessageResponse) => {
      // Callback opcional para confirmar que el mensaje fue recibido
      console.log('Respuesta del servidor al enviar mensaje:', response);
    });
    
    // Añadir mensaje a la UI inmediatamente - OPCIÓN 1: Comentar estas líneas si quieres esperar a que el servidor devuelva el mensaje
    const newMessage: Message = {
      message: input,
      sender: 'client',
      timestamp: new Date().toISOString(),
      conversationId: activeConversation,
      _localId: Date.now().toString() // Identificador local para seguimiento
    };
    
    setMessages((prev) => [...prev, newMessage]);
    
    // Limpiar el input y hacer scroll
    setInput('');
    scrollToBottom();
  };

  // Función para forzar la reconexión
  const forceReconnect = () => {
    console.log('Forzando reconexión...');
    if (socket) {
      socket.disconnect();
      // Resetear el estado de la conversación al reconectar
      conversationCreated.current = false;
      setTimeout(() => {
        socket.connect();
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col h-[600px] max-w-md mx-auto bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
      <div className="bg-blue-600 p-4 flex justify-between items-center text-white">
        <h3 className="text-lg font-semibold">Chat con Soporte</h3>
        <div className="flex items-center">
          <span
            className={`inline-block w-3 h-3 rounded-full mr-2 ${
              isConnected ? 'bg-green-400' : 'bg-red-400'
            }`}
            title={isConnected ? 'Conectado' : 'Desconectado'}
          />
          {!isConnected && (
            <button 
              onClick={forceReconnect}
              className="text-xs bg-blue-700 hover:bg-blue-800 px-2 py-1 rounded"
              title="Intentar reconectar"
            >
              Reconectar
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
        {isConnected ? (
          messages.length > 0 ? (
            messages.map((msg, index) => (
              <div
                key={msg.id || msg._localId || `msg-${index}`}
                className={`flex ${
                  msg.sender === 'client' ? 'justify-end' : 'justify-start'
                } mb-4`}
              >
                <div
                  className={`max-w-[70%] p-3 rounded-lg shadow ${
                    msg.sender === 'client'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-800'
                  }`}
                >
                  <p>{msg.message}</p>
                  <span className="text-xs opacity-75 block mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-center">
              No hay mensajes aún. Escribe para comenzar la conversación.
            </p>
          )
        ) : (
          <div className="text-center">
            <p className="text-gray-500 mb-2">{connectionStatus}</p>
            <p className="text-xs text-gray-400">Socket ID: {socketId || 'No conectado'}</p>
            {activeConversation && (
              <p className="text-xs text-gray-400 mt-1">Conversación: {activeConversation}</p>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 bg-gray-100 border-t flex items-center space-x-2 text-black">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Escribe un mensaje..."
          disabled={!isConnected || !activeConversation}
        />
        <button
          onClick={sendMessage}
          className={`p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors ${
            !isConnected || !activeConversation || !input.trim() ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          disabled={!isConnected || !activeConversation || !input.trim()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default function ChatPage() {
  // En una aplicación real, este ID vendría de la autenticación del usuario
  const userId = `user_${Math.floor(Math.random() * 10000)}`;
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6 text-center">Soporte al Cliente</h1>
      <ChatCliente chatId={userId} />
    </div>
  );
}