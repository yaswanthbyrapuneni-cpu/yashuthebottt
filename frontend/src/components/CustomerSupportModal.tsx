import React, { useState } from 'react';
import { X, MessageCircle, ChevronRight } from 'lucide-react';

interface FAQ {
  question: string;
  answer: string;
}

interface CustomerSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  faqs: FAQ[];
}

export function CustomerSupportModal({ isOpen, onClose, faqs }: CustomerSupportModalProps) {
  const [messages, setMessages] = useState<Array<{ text: string; isBot: boolean }>>([
    { text: "Hi! How can I help you today?", isBot: true }
  ]);
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleQuestionClick = (faq: FAQ, index: number) => {
    setSelectedQuestion(index);
    setMessages([
      ...messages,
      { text: faq.question, isBot: false },
      { text: faq.answer, isBot: true }
    ]);
  };

  const resetChat = () => {
    setMessages([{ text: "Hi! How can I help you today?", isBot: true }]);
    setSelectedQuestion(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full h-[600px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-[#7C563D] to-[#9A6D4F]">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-white" />
            <h2 className="text-xl font-semibold text-white">Customer Support</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.isBot ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.isBot
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'bg-[#7C563D] text-white'
                }`}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Reply Buttons */}
        <div className="p-4 border-t border-gray-200 bg-white">
          {selectedQuestion === null ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-3">Select a question:</p>
              {faqs.map((faq, index) => (
                <button
                  key={index}
                  onClick={() => handleQuestionClick(faq, index)}
                  className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors flex items-center justify-between group"
                >
                  <span className="text-sm text-gray-700 font-medium">{faq.question}</span>
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#7C563D] transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={resetChat}
                className="w-full px-4 py-3 bg-[#7C563D] hover:bg-[#6A4A33] text-white rounded-xl transition-colors text-sm font-medium"
              >
                Ask Another Question
              </button>
              <p className="text-xs text-gray-500 text-center">
                Need more help? Contact us at support@alankaraai.com
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}