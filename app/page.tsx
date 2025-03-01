'use client';

import React, { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

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
    [key: string]: unknown;
  };
  timestamp?: unknown;
}

interface ConnectionResponse {
  status: string;
  socketId?: string;
  timestamp?: string;
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
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectInterval = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Función para inicializar el socket
  const initializeSocket = () => {
    if (socketRef.current) {
      // Limpiar listeners existentes antes de reconectar
      socketRef.current.off();
      socketRef.current.close();
    }

    socketRef.current = io('https://backoffice-casino-back-production.up.railway.app', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      forceNew: true,
    });
    
    socketInitialized.current = true;
    
    // Configurar event listeners inmediatamente
    setupSocketListeners();
  };

  // Función para configurar los event listeners del socket
  const setupSocketListeners = () => {
    if (!socketRef.current) return;
    
    const socket = socketRef.current;

    // Función para manejar la conexión
    const handleConnect = () => {
      console.log('Cliente conectado al servidor WebSocket');
      console.log('Socket ID:', socket.id);
      setSocketId(socket.id || null);
      setIsConnected(true);
      setConnectionStatus('Conectado');
      reconnectAttempts.current = 0;
      
      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
        reconnectInterval.current = null;
      }
      
      // Unirse al chat como usuario
      socket.emit('joinChat', { userId: chatId });
      
      // Verificar la conexión
      socket.emit('checkConnection', (response: ConnectionResponse) => {
        console.log('Estado de conexión:', response);
      });
    };

    // Función para crear una conversación para el usuario
    const createConversation = () => {
      // Evitar crear múltiples conversaciones
      if (conversationCreated.current) {
        console.log('Ya se ha creado una conversación, no se creará otra');
        return;
      }
      
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
      
      // Iniciar reconexión automática si no está ya en progreso
      if (!reconnectInterval.current && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectInterval.current = setInterval(() => {
          if (reconnectAttempts.current >= maxReconnectAttempts) {
            if (reconnectInterval.current) {
              clearInterval(reconnectInterval.current);
              reconnectInterval.current = null;
            }
            setConnectionStatus(`No se pudo reconectar después de ${maxReconnectAttempts} intentos. Por favor, recarga la página.`);
            return;
          }
          
          reconnectAttempts.current++;
          setConnectionStatus(`Intentando reconectar (${reconnectAttempts.current}/${maxReconnectAttempts})...`);
          
          // Reinicializar el socket
          initializeSocket();
        }, 5000);
      }
    };

    // Función para manejar desconexiones
    const handleDisconnect = (reason: string) => {
      console.log('Cliente desconectado del servidor WebSocket. Razón:', reason);
      setIsConnected(false);
      setConnectionStatus(`Desconectado: ${reason}. Intentando reconectar...`);
      
      // Iniciar reconexión automática si no está ya en progreso
      if (!reconnectInterval.current && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectInterval.current = setInterval(() => {
          if (reconnectAttempts.current >= maxReconnectAttempts) {
            if (reconnectInterval.current) {
              clearInterval(reconnectInterval.current);
              reconnectInterval.current = null;
            }
            setConnectionStatus(`No se pudo reconectar después de ${maxReconnectAttempts} intentos. Por favor, recarga la página.`);
            return;
          }
          
          reconnectAttempts.current++;
          setConnectionStatus(`Intentando reconectar (${reconnectAttempts.current}/${maxReconnectAttempts})...`);
          
          // Reinicializar el socket
          initializeSocket();
        }, 5000);
      }
    };

    // Función para manejar mensajes nuevos
    const handleNewMessage = (message: Message) => {
      // Verificar si el mensaje pertenece a nuestra conversación activa
      // Comparar como strings para evitar problemas de tipo
      const messageConvId = String(message.conversationId || '');
      const activeConvId = String(activeConversation || '');
      
      if (activeConversation && message.conversationId && 
          messageConvId === activeConvId) {
        
        // Si el mensaje es del mismo usuario y tiene el mismo contenido que el último mensaje enviado,
        // podría ser un duplicado enviado por el servidor
        if (lastSentMessageId.current && message.message === lastSentMessageId.current) {
          // Actualizamos lastSentMessageId para evitar futuras confusiones
          lastSentMessageId.current = null;
          return;
        }
        
        setMessages((prev) => {
          // Verificar si el mensaje ya existe en el array para evitar duplicados
          const isDuplicate = prev.some(
            (msg) => 
              msg.id === message.id || 
              (msg.message === message.message && 
              msg.sender === message.sender &&
              Math.abs(new Date(msg.timestamp).getTime() - new Date(message.timestamp).getTime()) < 3000) // 3 segundos de margen
          );
          
          if (isDuplicate) {
            return prev;
          }
          
          const newMessage = {
            ...message,
            id: message.id || `local_${Date.now()}`
          };
          
          return [...prev, newMessage];
        });
        
        scrollToBottom();
      } else {
        // Intentar añadir el mensaje de todos modos si tiene un conversationId válido
        // Esto puede ayudar en casos donde activeConversation no se ha actualizado correctamente
        if (message.conversationId) {
          // Si no tenemos una conversación activa pero el mensaje tiene una, actualizar la conversación activa
          if (!activeConversation) {
            console.log('Actualizando conversación activa con:', message.conversationId);
            setActiveConversation(message.conversationId);
            conversationCreated.current = true;
          }
          
          // Añadir el mensaje a la UI de todos modos
          setMessages((prev) => {
            // Verificar si el mensaje ya existe en el array para evitar duplicados
            const isDuplicate = prev.some(
              (msg) => 
                msg.id === message.id || 
                (msg.message === message.message && 
                msg.sender === message.sender &&
                Math.abs(new Date(msg.timestamp).getTime() - new Date(message.timestamp).getTime()) < 3000)
            );
            
            if (isDuplicate) {
              return prev;
            }
            
            const newMessage = {
              ...message,
              id: message.id || `local_${Date.now()}`
            };
            
            return [...prev, newMessage];
          });
          
          scrollToBottom();
        }
      }
    };

    // Función para manejar el historial de mensajes
    const handleMessageHistory = (messages: Message[]) => {
      console.log('Historial de mensajes recibido:', messages.length);
      if (Array.isArray(messages)) {
        // Asegurar que todos los mensajes tengan IDs
        const messagesWithIds = messages.map(msg => ({
          ...msg,
          id: msg.id || `hist_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        }));
        setMessages(messagesWithIds);
      } else {
        setMessages([]);
      }
      scrollToBottom();
    };

    // Función para manejar confirmaciones de mensajes
    const handleMessageConfirmation = (response: MessageResponse) => {
      if (response.success) {
        // Actualizar el último mensaje enviado con el ID del servidor
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && !lastMessage.id && lastMessage._localId) {
            const updatedMessages = [...prev];
            updatedMessages[prev.length - 1] = {
              ...lastMessage,
              id: response.data?.messageId,
              timestamp: response.data?.timestamp as string || lastMessage.timestamp
            };
            return updatedMessages;
          }
          return prev;
        });
      }
    };

    // Función para manejar las conversaciones del usuario
    const handleUserConversations = (conversations: Conversation[]) => {
      if (conversations && conversations.length > 0) {
        // Usar la primera conversación activa
        const activeConv = conversations.find(conv => conv.status === 'active');
        if (activeConv) {
          setActiveConversation(activeConv.id);
          conversationCreated.current = true; // Marcar que ya tenemos una conversación
          console.log('ID de conversación activa establecida:', activeConv.id);
          
          // Solicitar mensajes de esta conversación
          socket.emit('getMessages', { conversationId: activeConv.id });
        } else {
          // Si no hay conversaciones activas, crear una nueva
          createConversation();
        }
      } else {
        // Si no hay conversaciones, crear una nueva
        createConversation();
      }
    };

    // Función para manejar la asignación de agente
    const handleAgentAssigned = (data: { conversationId: string; agentId: string }) => {
      console.log('Agente asignado a la conversación:', data);
      
      if (data.conversationId === activeConversation) {
        // Notificar al usuario que un agente se ha unido al chat
        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Un agente se ha unido al chat y te atenderá en breve.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: activeConversation
        };
        
        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();
      } else if (data.conversationId) {
        // Si no coincide pero tenemos un ID de conversación válido, actualizar la conversación activa
        console.log('Actualizando conversación activa en handleAgentAssigned:', data.conversationId);
        setActiveConversation(data.conversationId);
        conversationCreated.current = true;
        
        // Notificar al usuario que un agente se ha unido al chat
        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Un agente se ha unido al chat y te atenderá en breve.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: data.conversationId
        };
        
        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();
      }
    };

    // Función para manejar el archivado del chat
    const handleChatArchived = (data: { conversationId: string }) => {
      console.log('Chat archivado:', data);
      if (data.conversationId === activeConversation) {
        // Notificar al usuario que el chat ha sido archivado
        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Este chat ha sido archivado. Si necesitas más ayuda, por favor inicia un nuevo chat.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: activeConversation
        };
        
        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();
        
        // Resetear el estado de la conversación
        setActiveConversation(null);
        conversationCreated.current = false;
      }
    };

    // Función para manejar pings del servidor
    const handlePing = () => {
      // Responder con un pong para mantener la conexión activa
      socket.emit('pong');
    };

    // Registrar los event listeners
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('message', handleNewMessage);
    socket.on('newMessage', handleNewMessage); // Asegurarse de escuchar ambos eventos
    socket.on('messageHistory', handleMessageHistory);
    socket.on('messageConfirmation', handleMessageConfirmation);
    socket.on('userConversations', handleUserConversations);
    socket.on('agentAssigned', handleAgentAssigned);
    socket.on('chatArchived', handleChatArchived);
    socket.on('ping', handlePing);

    // Evento personalizado para depuración
    socket.on('error', (error: Error) => {
      console.error('Error en el socket:', error);
      setConnectionStatus(`Error en el socket: ${error.message || 'Desconocido'}`);
    });
  };

  // Inicializar el socket solo una vez
  useEffect(() => {
    if (!socketInitialized.current) {
      initializeSocket();
    }
    
    // Configurar un ping periódico para mantener la conexión activa
    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        console.log('Enviando ping al servidor...');
        socketRef.current.emit('checkConnection', (response: ConnectionResponse) => {
          console.log('Respuesta de ping:', response);
        });
      }
    }, 30000); // Cada 30 segundos
    
    return () => {
      // Limpiar intervalos
      clearInterval(pingInterval);
      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
      }
      
      // Desconectar el socket
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Efecto para manejar cambios en la conversación activa
  useEffect(() => {
    if (activeConversation && socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('getMessages', { conversationId: activeConversation });
    }
  }, [activeConversation]);

  const sendMessage = () => {
    if (!input.trim() || !isConnected || !socketRef.current) return;
    
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
    
    // Enviar mensaje al servidor usando WebSocket
    socketRef.current.emit('clientMessage', messageData);
    
    // Añadir mensaje a la UI inmediatamente
    const newMessage: Message = {
      message: input,
      sender: 'client',
      timestamp: new Date().toISOString(),
      conversationId: activeConversation,
      _localId: Date.now().toString()
    };
    
    setMessages((prev) => [...prev, newMessage]);
    
    // Limpiar el input y hacer scroll
    setInput('');
    scrollToBottom();
  };

  // Función para forzar la reconexión
  const forceReconnect = () => {
    console.log('Forzando reconexión...');
    reconnectAttempts.current = 0;
    setConnectionStatus('Reconectando...');
    initializeSocket();
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
                  msg.sender === 'client' ? 'justify-end' : 
                  msg.sender === 'system' ? 'justify-center' : 'justify-start'
                } mb-4`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg shadow ${
                    msg.sender === 'client'
                      ? 'bg-blue-500 text-white'
                      : msg.sender === 'system'
                      ? 'bg-gray-300 text-gray-800 text-center'
                      : 'bg-gray-200 text-gray-800'
                  }`}
                >
                  <p>{msg.message}</p>
                  {msg.sender !== 'system' && (
                    <span className="text-xs opacity-75 block mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  )}
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