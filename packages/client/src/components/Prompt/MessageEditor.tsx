import { useState } from 'react';
import { Trash2, GripVertical, ChevronDown, ChevronRight, User, Bot, Settings } from 'lucide-react';
import { PromptMessage, PromptMessageRole } from '../../types/database';

interface MessageEditorProps {
  message: PromptMessage;
  onChange: (message: PromptMessage) => void;
  onDelete: () => void;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
}

const ROLE_CONFIG: Record<PromptMessageRole, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  system: {
    label: 'System',
    icon: <Settings className="w-4 h-4" />,
    color: 'text-purple-400 light:text-purple-600',
    bgColor: 'bg-purple-500/10 light:bg-purple-100',
  },
  user: {
    label: 'User',
    icon: <User className="w-4 h-4" />,
    color: 'text-blue-400 light:text-blue-600',
    bgColor: 'bg-blue-500/10 light:bg-blue-100',
  },
  assistant: {
    label: 'Assistant',
    icon: <Bot className="w-4 h-4" />,
    color: 'text-green-400 light:text-green-600',
    bgColor: 'bg-green-500/10 light:bg-green-100',
  },
};

export function MessageEditor({
  message,
  onChange,
  onDelete,
  isDragging = false,
  dragHandleProps,
}: MessageEditorProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);

  const roleConfig = ROLE_CONFIG[message.role];

  const handleRoleChange = (role: PromptMessageRole) => {
    onChange({ ...message, role });
    setIsRoleMenuOpen(false);
  };

  const handleContentChange = (content: string) => {
    onChange({ ...message, content });
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${
        isDragging
          ? 'border-cyan-500 shadow-lg shadow-cyan-500/20'
          : 'border-slate-700 light:border-slate-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 light:bg-slate-50 border-b border-slate-700 light:border-slate-200">
        {/* Drag handle */}
        <div
          {...dragHandleProps}
          className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 light:hover:text-slate-700"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-slate-400 hover:text-slate-200 light:hover:text-slate-700"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {/* Role selector */}
        <div className="relative">
          <button
            onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium ${roleConfig.bgColor} ${roleConfig.color} hover:opacity-80 transition-opacity`}
          >
            {roleConfig.icon}
            <span>{roleConfig.label}</span>
            <ChevronDown className="w-3 h-3 ml-1" />
          </button>

          {isRoleMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsRoleMenuOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 z-20 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg shadow-lg overflow-hidden min-w-[120px]">
                {(Object.keys(ROLE_CONFIG) as PromptMessageRole[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(role)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-700 light:hover:bg-slate-100 transition-colors ${
                      message.role === role
                        ? ROLE_CONFIG[role].color
                        : 'text-slate-300 light:text-slate-700'
                    }`}
                  >
                    {ROLE_CONFIG[role].icon}
                    <span>{ROLE_CONFIG[role].label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Content preview when collapsed */}
        {isCollapsed && (
          <span className="flex-1 text-sm text-slate-400 light:text-slate-500 truncate">
            {message.content.slice(0, 50)}
            {message.content.length > 50 && '...'}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="p-1 text-slate-500 hover:text-red-400 light:hover:text-red-500 transition-colors"
          title="Delete message"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Content editor */}
      {!isCollapsed && (
        <div className="p-3 bg-slate-900/30 light:bg-white">
          <textarea
            value={message.content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder={`Enter ${message.role} message...`}
            className="w-full min-h-[120px] px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Supports Jinja2 template syntax: {"{{ variable }}"}</span>
            <span>{message.content.length} characters</span>
          </div>
        </div>
      )}
    </div>
  );
}
