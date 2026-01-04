import { useState, useCallback } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { PromptMessage, PromptMessageRole } from '../../types/database';
import { MessageEditor } from './MessageEditor';
import { Button } from '../ui';

interface MessageListProps {
  messages: PromptMessage[];
  onChange: (messages: PromptMessage[]) => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function MessageList({ messages, onChange }: MessageListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleAddMessage = (role: PromptMessageRole = 'user') => {
    const newMessage: PromptMessage = {
      id: generateId(),
      role,
      content: '',
    };
    onChange([...messages, newMessage]);
  };

  const handleUpdateMessage = useCallback(
    (index: number, updatedMessage: PromptMessage) => {
      const newMessages = [...messages];
      newMessages[index] = updatedMessage;
      onChange(newMessages);
    },
    [messages, onChange]
  );

  const handleDeleteMessage = useCallback(
    (index: number) => {
      const newMessages = messages.filter((_, i) => i !== index);
      onChange(newMessages);
    },
    [messages, onChange]
  );

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newMessages = [...messages];
      const [draggedMessage] = newMessages.splice(draggedIndex, 1);
      newMessages.splice(dragOverIndex, 0, draggedMessage);
      onChange(newMessages);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="space-y-4">
      {/* Messages list */}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
          <h3 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
            No messages yet
          </h3>
          <p className="text-sm text-slate-500 light:text-slate-500 mb-4">
            Add messages to create a multi-turn conversation prompt
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleAddMessage('system')}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add System
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleAddMessage('user')}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add User
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message, index) => (
            <div
              key={message.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`transition-transform ${
                dragOverIndex === index && draggedIndex !== null
                  ? draggedIndex < index
                    ? 'translate-y-2'
                    : '-translate-y-2'
                  : ''
              }`}
            >
              <MessageEditor
                message={message}
                onChange={(updated) => handleUpdateMessage(index, updated)}
                onDelete={() => handleDeleteMessage(index)}
                isDragging={draggedIndex === index}
                dragHandleProps={{
                  onMouseDown: () => {},
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add message buttons */}
      {messages.length > 0 && (
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAddMessage('system')}
            className="text-purple-400 light:text-purple-600 hover:text-purple-300 light:hover:text-purple-700"
          >
            <Plus className="w-4 h-4 mr-1" />
            System
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAddMessage('user')}
            className="text-blue-400 light:text-blue-600 hover:text-blue-300 light:hover:text-blue-700"
          >
            <Plus className="w-4 h-4 mr-1" />
            User
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAddMessage('assistant')}
            className="text-green-400 light:text-green-600 hover:text-green-300 light:hover:text-green-700"
          >
            <Plus className="w-4 h-4 mr-1" />
            Assistant
          </Button>
        </div>
      )}

      {/* Quick template buttons */}
      {messages.length === 0 && (
        <div className="border border-dashed border-slate-700 light:border-slate-300 rounded-lg p-4">
          <p className="text-sm text-slate-400 light:text-slate-600 mb-3">
            Quick start templates:
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange([
                  { id: generateId(), role: 'system', content: 'You are a helpful assistant.' },
                  { id: generateId(), role: 'user', content: '' },
                ]);
              }}
            >
              System + User
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange([
                  { id: generateId(), role: 'system', content: 'You are a helpful assistant.' },
                  { id: generateId(), role: 'user', content: '' },
                  { id: generateId(), role: 'assistant', content: '' },
                  { id: generateId(), role: 'user', content: '' },
                ]);
              }}
            >
              Multi-turn Chat
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange([
                  { id: generateId(), role: 'user', content: '' },
                ]);
              }}
            >
              Simple User Prompt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
