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
  _localId?: string; // Local field for tracking
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

interface ChatResponse {
  success: boolean;
  message?: string;
  data?: {
    conversationId?: string;
    [key: string]: unknown;
  };
}

interface ChatProps {
  chatId: string; // The client's userId
}

const ChatCliente: React.FC<ChatProps> = ({ chatId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [officeId, setOfficeId] = useState<string>('1');
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Conectando al chat...');
  const [socketId, setSocketId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
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

  const initializeSocket = () => {
    if (socketRef.current) {
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
    setupSocketListeners();
  };

  const setupSocketListeners = () => {
    if (!socketRef.current) return;

    const socket = socketRef.current;

    const handleConnect = () => {
      console.log('Client connected to WebSocket server');
      setSocketId(socket.id || null);
      setIsConnected(true);
      setConnectionStatus('Conectado');
      reconnectAttempts.current = 0;

      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
        reconnectInterval.current = null;
      }

      socket.emit('joinChat', { 
        userId: chatId,
        officeId: officeId
      }, (response: ChatResponse) => {
        if (response && response.success) {
          socket.emit('getUserConversations', { 
            userId: chatId,
            officeId: officeId
          });
        }
      });

      socket.emit('checkConnection');
    };

    const handleConnectError = (err: Error) => {
      console.error('WebSocket connection error in client:', err.message);
      setIsConnected(false);
      setConnectionStatus(`Error de conexión: ${err.message}. Intentando reconectar...`);

      // Start automatic reconnection if not already in progress
      if (!reconnectInterval.current && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectInterval.current = setInterval(() => {
          if (reconnectAttempts.current >= maxReconnectAttempts) {
            if (reconnectInterval.current) {
              clearInterval(reconnectInterval.current);
              reconnectInterval.current = null;
            }
            setConnectionStatus(`No se pudo reconectar después de ${maxReconnectAttempts} intentos. Por favor recarga la página.`);
            return;
          }

          reconnectAttempts.current++;
          setConnectionStatus(`Intentando reconectar (${reconnectAttempts.current}/${maxReconnectAttempts})...`);

          initializeSocket();
        }, 5000);
      }
    };

    const handleDisconnect = (reason: string) => {
      console.log('Client disconnected from WebSocket server. Reason:', reason);
      setIsConnected(false);
      setConnectionStatus(`Desconectado: ${reason}. Intentando reconectar...`);

      // Start automatic reconnection if not already in progress
      if (!reconnectInterval.current && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectInterval.current = setInterval(() => {
          if (reconnectAttempts.current >= maxReconnectAttempts) {
            if (reconnectInterval.current) {
              clearInterval(reconnectInterval.current);
              reconnectInterval.current = null;
            }
            setConnectionStatus(`No se pudo reconectar después de ${maxReconnectAttempts} intentos. Por favor recarga la página.`);
            return;
          }

          reconnectAttempts.current++;
          setConnectionStatus(`Intentando reconectar (${reconnectAttempts.current}/${maxReconnectAttempts})...`);

          initializeSocket();
        }, 5000);
      }
    };

    const handleNewMessage = (message: Message) => {
      // Check if the message belongs to our active conversation
      const messageConvId = String(message.conversationId || '');
      const activeConvId = String(activeConversation || '');

      if (activeConversation && message.conversationId &&
        messageConvId === activeConvId) {

        // Avoid duplicates of messages sent by the user
        if (lastSentMessageId.current && message.message === lastSentMessageId.current) {
          lastSentMessageId.current = null;
          return;
        }

        setMessages((prev) => {
          // Check if the message already exists to avoid duplicates
          const isDuplicate = prev.some(
            (msg) =>
              msg.id === message.id ||
              (msg.message === message.message &&
                msg.sender === message.sender &&
                Math.abs(new Date(msg.timestamp).getTime() - new Date(message.timestamp).getTime()) < 3000) // 3 second margin
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
      } else if (message.conversationId) {
        // If we don't have an active conversation but the message has one, update the active conversation
        if (!activeConversation) {
          setActiveConversation(message.conversationId);
          conversationCreated.current = true;
        }

        setMessages((prev) => {
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
    };

    const handleMessageHistory = (messages: Message[]) => {
      if (Array.isArray(messages)) {
        // Ensure all messages have IDs
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

    const handleMessageConfirmation = (response: MessageResponse) => {
      if (response.success) {
        // Update the last sent message with the server ID
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

    const handleUserConversations = (conversations: Conversation[]) => {
      if (conversations && conversations.length > 0) {
        const activeConv = conversations.find(conv => conv.status === 'active');
        if (activeConv) {
          setActiveConversation(activeConv.id);
          conversationCreated.current = true;
          socket.emit('getMessages', { conversationId: activeConv.id });
        }
      }
    };

    const handleAgentAssigned = (data: { conversationId: string; agentId: string }) => {
      console.log('Agent assigned to conversation:', data);

      if (data.conversationId === activeConversation) {
        // Notify the user that an agent has joined the chat
        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Un agente se ha unido al chat y te asistirá en breve.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: activeConversation
        };

        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();
      } else if (data.conversationId) {
        setActiveConversation(data.conversationId);
        conversationCreated.current = true;

        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Un agente se ha unido al chat y te asistirá en breve.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: data.conversationId
        };

        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();
      }
    };

    const handleChatArchived = (data: { conversationId: string }) => {
      console.log('Chat archived:', data);
      if (data.conversationId === activeConversation) {
        // Notify the user that the chat has been archived
        const systemMessage: Message = {
          id: `system_${Date.now()}`,
          message: 'Este chat ha sido archivado. Si necesitas más ayuda, por favor inicia un nuevo chat.',
          sender: 'system',
          timestamp: new Date().toISOString(),
          conversationId: activeConversation
        };

        setMessages(prev => [...prev, systemMessage]);
        scrollToBottom();

        setActiveConversation(null);
        conversationCreated.current = false;
      }
    };

    const handlePing = () => {
      socket.emit('pong');
    };

    // Register event listeners
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('message', handleNewMessage);
    socket.on('newMessage', handleNewMessage); // Listen to both events
    socket.on('messageHistory', handleMessageHistory);
    socket.on('messageConfirmation', handleMessageConfirmation);
    socket.on('userConversations', handleUserConversations);
    socket.on('agentAssigned', handleAgentAssigned);
    socket.on('chatArchived', handleChatArchived);
    socket.on('ping', handlePing);

    // Add handler for message errors if the event exists
    socket.on('messageError', (error: {message: string}) => {
      console.error('Error al enviar el mensaje:', error);
      setConnectionStatus(`Error: ${error.message || 'Error al enviar el mensaje'}`);
      setIsSending(false);
    });

    socket.on('error', (error: Error) => {
      console.error('Socket error:', error);
      setConnectionStatus(`Socket error: ${error.message || 'Unknown'}`);
      setIsSending(false);
    });
  };

  useEffect(() => {
    if (!socketInitialized.current) {
      initializeSocket();
    }

    setOfficeId('1');

    // Periodic ping to keep the connection active
    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('checkConnection');
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
      }

      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (activeConversation && socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('getMessages', { conversationId: activeConversation });
    }
  }, [activeConversation]);

  const sendMessage = () => {
    if (!input.trim() || !isConnected || !socketRef.current || isSending) return;
    setIsSending(true);

    const socket = socketRef.current;
    const localId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const tempMessage: Message = {
      _localId: localId,
      userId: chatId,
      message: input,
      sender: 'client',
      timestamp: new Date().toISOString(),
      conversationId: activeConversation || undefined // Include active conversation if available
    };

    setMessages((prev) => [...prev, tempMessage]);
    lastSentMessageId.current = input;
    setInput('');
    scrollToBottom();

    // Ensure conversation exists or create one
    if (!activeConversation) {
      if (!conversationCreated.current) {
        console.log('No active conversation, attempting to create one...');
        socket.emit('createConversation', {
          userId: chatId,
          officeId: officeId
        }, (response: ChatResponse) => {
          if (response && response.success && response.data?.conversationId) {
            const newConversationId = response.data.conversationId;
            console.log(`Conversation created/found: ${newConversationId}`);
            setActiveConversation(newConversationId);
            conversationCreated.current = true; // Mark as created

            // Retry sending the message with the new conversation ID
            socket.emit('clientMessage', {
              userId: chatId,
              message: tempMessage.message,
              conversationId: newConversationId
            }, (ack: MessageResponse) => {
              setIsSending(false);
              if (ack && ack.success && ack.data?.messageId) {
                // Update message ID on success
                setMessages(prev => prev.map(msg =>
                  msg._localId === localId ? { ...msg, id: ack.data?.messageId, _localId: undefined } : msg
                ));
              } else {
                console.error('Error sending message after creating conversation:', ack?.message);
                // Handle error: maybe mark the message as failed
              }
            });
          } else {
            setIsSending(false);
            console.error('Failed to create or find conversation:', response?.message);
            // Handle error: remove temp message or mark as failed
            setMessages(prev => prev.filter(msg => msg._localId !== localId));
            lastSentMessageId.current = null; // Reset last sent message
          }
        });
      } else {
        setIsSending(false);
        console.warn('Cannot send message: Still waiting for conversation creation confirmation.');
        // Optionally re-add input to the text area
        setInput(tempMessage.message);
        setMessages(prev => prev.filter(msg => msg._localId !== localId)); // Remove temp message
        lastSentMessageId.current = null;
      }
    } else {
      // If conversation already exists, send the message directly
      socket.emit('clientMessage', {
        userId: chatId,
        message: tempMessage.message,
        conversationId: activeConversation
      }, (ack: MessageResponse) => {
        setIsSending(false);
        if (ack && ack.success && ack.data?.messageId) {
          // Update message ID on success
          setMessages(prev => prev.map(msg =>
            msg._localId === localId ? { ...msg, id: ack.data?.messageId, _localId: undefined } : msg
          ));
        } else {
          console.error('Error sending message:', ack?.message);
          // Handle error: maybe mark the message as failed
        }
      });
    }
  };

  const forceReconnect = () => {
    console.log('Forcing reconnection...');
    reconnectAttempts.current = 0;
    setConnectionStatus('Reconnecting...');
    initializeSocket();
  };

  return (
    <div className="flex flex-col h-[600px] max-w-md mx-auto bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
      <div className="bg-blue-600 p-4 flex justify-between items-center text-white">
        <h3 className="text-lg font-semibold">Chat con Soporte</h3>
        <div className="flex items-center">
          <span
            className={`inline-block w-3 h-3 rounded-full mr-2 ${isConnected ? 'bg-green-400' : 'bg-red-400'
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
                className={`flex ${msg.sender === 'client' ? 'justify-end' :
                    msg.sender === 'system' ? 'justify-center' : 'justify-start'
                  } mb-4`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg shadow ${msg.sender === 'client'
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
              Escribe tu primer mensaje para comenzar una conversación con soporte.
            </p>
          )
        ) : (
          <div className="text-center">
            <p className={`mb-2 ${
              connectionStatus.includes('Enviando') || connectionStatus.includes('Creando') 
                ? 'text-blue-500 font-medium animate-pulse'
                : connectionStatus.includes('Error')
                  ? 'text-red-500'
                  : 'text-gray-500'
            }`}>
              {connectionStatus}
            </p>
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
          disabled={!isConnected || isSending}
        />
        <button
          onClick={sendMessage}
          className={`p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors ${!isConnected || !input.trim() || isSending ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          disabled={!isConnected || !input.trim() || isSending}
        >
          {isSending ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" title="Enviando..."/>
          ) : (
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
          )}
        </button>
      </div>
    </div>
  );
};

export default function ChatPage() {
  const userId = `user_${Math.floor(Math.random() * 10000)}`;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6 text-center">Soporte al Cliente</h1>
      <ChatCliente chatId={userId} />
    </div>
  );
}