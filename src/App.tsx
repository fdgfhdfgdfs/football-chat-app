import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Copy, Users, ArrowRight, Send, Share2, MessageCircle, Play, Check, X, Trophy, MessageSquare } from 'lucide-react';

const socket: Socket = io();

type Message = { id: string; senderId: string; senderName: string; text: string; timestamp: number };
type Player = { id: string; name: string; score: number; connected?: boolean };
type Submission = { playerId: string; playerName: string; answer: string; wager: number; judged: boolean; isCorrect?: boolean };
type RoomState = 'waiting' | 'asking' | 'playing' | 'judging';

export default function App() {
  const [userId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [inRoom, setInRoom] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [userName, setUserName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Game State
  const [adminId, setAdminId] = useState('');
  const [gameState, setGameState] = useState<RoomState>('waiting');
  const [currentJudgeId, setCurrentJudgeId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [usedWagers, setUsedWagers] = useState<Record<string, number[]>>({});
  const [timerEnd, setTimerEnd] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  
  // UI State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [wagerInput, setWagerInput] = useState(1);

  useEffect(() => {
    socket.on('room-created', (data: { roomCode: string }) => {
      setRoomCode(data.roomCode);
      setInRoom(true);
      setError('');
    });

    socket.on('room-joined', (data: { roomCode: string }) => {
      setRoomCode(data.roomCode);
      setInRoom(true);
      setError('');
    });

    socket.on('room-update', (room: any) => {
      setPlayers(room.players);
      setMessages(room.messages);
      setAdminId(room.adminId);
      setGameState(room.gameState);
      setCurrentJudgeId(room.currentJudgeId);
      setCurrentQuestion(room.currentQuestion);
      setSubmissions(room.submissions);
      setUsedWagers(room.usedWagers);
      setTimerEnd(room.timerEnd);
    });

    socket.on('new-message', (message: Message) => {
      setMessages(prev => [...prev, message]);
      setHasUnreadMessages(prev => isChatOpen ? false : true);
    });

    socket.on('error', (msg: string) => {
      setError(msg);
      if (msg === "الغرفة غير موجودة") {
        setInRoom(false);
        setRoomCode('');
      }
    });

    return () => {
      socket.off('room-created');
      socket.off('room-joined');
      socket.off('room-update');
      socket.off('new-message');
      socket.off('error');
    };
  }, []);

  useEffect(() => {
    const onConnect = () => {
      if (inRoom && roomCode && userName) {
        socket.emit('join-room', { roomCode, userName, userId });
      }
    };
    
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [inRoom, roomCode, userName, userId]);

  useEffect(() => {
      if (isChatOpen) {
        setHasUnreadMessages(false);
      }
  }, [isChatOpen]);

  useEffect(() => {
    if (isChatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatOpen]);

  // Timer Effect
  useEffect(() => {
    if (gameState === 'playing' && timerEnd) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining === 0) clearInterval(interval);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState, timerEnd]);

  // Reset inputs when state changes
  useEffect(() => {
    setAnswerInput('');
    // Find lowest available wager
    const used = usedWagers[userId] || [];
    let lowest = 1;
    for (let i = 1; i <= 20; i++) {
      if (!used.includes(i)) {
        lowest = i;
        break;
      }
    }
    setWagerInput(lowest);
  }, [gameState, usedWagers, userId]);

  const createRoom = () => {
    if (!userName.trim()) {
      setError('يرجى إدخال اسمك أولاً');
      return;
    }
    socket.emit('create-room', { userName: userName.trim(), userId });
  };

  const joinRoom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userName.trim()) {
      setError('يرجى إدخال اسمك أولاً');
      return;
    }
    if (joinCode.trim()) {
      socket.emit('join-room', { roomCode: joinCode.trim(), userName: userName.trim(), userId });
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() && inRoom) {
      socket.emit('send-message', { roomCode, text: newMessage.trim(), userId });
      setNewMessage('');
    }
  };

  const leaveRoom = () => {
    socket.emit('leave-room', { roomCode, userId });
    setInRoom(false);
    setRoomCode('');
    setMessages([]);
    setPlayers([]);
    setError('');
    setIsChatOpen(false);
  };

  const shareCode = async () => {
    const shareData = {
      title: 'تحدي كرة القدم!',
      text: `انضم إلى غرفتي لتحدي كرة القدم! كود الغرفة هو: ${roomCode}`,
      url: window.location.href,
    };

    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Game Actions
  const startChallenge = () => {
    socket.emit('start-challenge', { roomCode, userId });
  };

  const submitQuestion = () => {
    if (!questionInput.trim()) return;
    socket.emit('submit-question', { roomCode, question: questionInput.trim(), userId });
    setQuestionInput('');
  };

  const submitAnswer = () => {
    if (!answerInput.trim()) return;
    socket.emit('submit-answer', { roomCode, answer: answerInput.trim(), wager: wagerInput, userId });
  };

  const judgeAnswer = (playerId: string, isCorrect: boolean) => {
    socket.emit('judge-answer', { roomCode, playerId, isCorrect, userId });
  };

  const nextTurn = () => {
    socket.emit('next-turn', { roomCode, userId });
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  };

  const isAdmin = userId === adminId;
  const isJudge = userId === currentJudgeId;
  const judgeName = players.find(p => p.id === currentJudgeId)?.name || 'اللاعب';
  const mySubmission = submissions.find(s => s.playerId === userId);

  if (!inRoom) {
    return (
      <div className="fixed inset-0 bg-[#f0f2f5] flex flex-col items-center justify-center p-4 font-sans" dir="rtl">
        <div className="absolute top-0 w-full h-40 bg-[#00a884]"></div>

        <div className="w-full max-w-md bg-white rounded-xl shadow-lg z-10 overflow-hidden">
          <div className="bg-[#008069] p-6 text-white text-center flex flex-col items-center">
            <Trophy size={48} className="mb-3 opacity-90" />
            <h1 className="text-2xl font-bold">تحدي كرة القدم</h1>
            <p className="text-white/80 text-sm mt-1">أنشئ غرفة وتحدى أصدقائك في معلومات الكرة</p>
          </div>

          <div className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">اسمك</label>
              <input
                type="text"
                placeholder="أدخل اسمك هنا..."
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all"
                maxLength={20}
              />
            </div>

            <div className="pt-2">
              <button
                onClick={createRoom}
                className="w-full bg-[#00a884] hover:bg-[#008f6f] text-white font-bold py-3.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Users size={20} />
                إنشاء غرفة جديدة
              </button>
            </div>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-gray-200"></div>
              <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">أو الانضمام لغرفة</span>
              <div className="flex-grow border-t border-gray-200"></div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">كود الغرفة</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="مثال: 1234"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-center tracking-widest text-lg"
                  maxLength={4}
                />
                <button
                  onClick={() => joinRoom()}
                  disabled={!joinCode.trim() || !userName.trim()}
                  className="px-6 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-sm"
                >
                  انضمام
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#efeae2] flex flex-col font-sans overflow-hidden" dir="rtl">
      {/* Header */}
      <header className="bg-[#008069] text-white px-3 py-2.5 flex items-center justify-between shadow-md z-20 shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={leaveRoom} className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex items-center justify-center">
            <ArrowRight size={22} />
          </button>
          
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0">
            <Trophy size={20} className="text-white" />
          </div>
          
          <div className="flex flex-col justify-center">
            <span className="font-semibold text-base sm:text-lg leading-tight">غرفة {roomCode}</span>
            <span className="text-[11px] sm:text-xs text-white/80 mt-0.5">{players.length} متصلين</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button onClick={() => setIsChatOpen(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors relative flex items-center justify-center">
            <MessageSquare size={20} />
            {hasUnreadMessages && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#008069]"></span>
            )}
          </button>
          <button onClick={shareCode} className="p-2 hover:bg-white/10 rounded-full transition-colors relative flex items-center justify-center">
            {navigator.share ? <Share2 size={20} /> : <Copy size={20} />}
            {copied && <span className="absolute top-10 left-0 text-[10px] bg-black/70 px-2 py-1 rounded text-white whitespace-nowrap animate-in fade-in">تم النسخ</span>}
          </button>
        </div>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col items-center relative z-10">
        
        {/* Scoreboard */}
        <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm p-4 mb-6">
          <h3 className="text-sm font-bold text-gray-500 mb-3 border-b pb-2">لوحة الشرف</h3>
          <div className="flex flex-wrap gap-3">
            {players.sort((a, b) => b.score - a.score).map((p, index) => (
              <div key={`${p.id}-${index}`} className={`bg-gray-50 border rounded-lg px-3 py-2 flex items-center gap-2 ${p.connected === false ? 'opacity-50' : ''}`}>
                <span className="font-semibold text-gray-800">{p.name}</span>
                <span className="bg-[#00a884] text-white text-xs font-bold px-2 py-1 rounded-full">{p.score} نقطة</span>
              </div>
            ))}
          </div>
        </div>

        {gameState === 'waiting' ? (
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm p-8 text-center flex flex-col items-center justify-center min-h-[40vh]">
            <Trophy size={64} className="text-yellow-500 mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">في انتظار بدء التحدي</h2>
            <p className="text-gray-500 mb-8">الأسئلة كروية، جهز معلوماتك!</p>
            
            {isAdmin ? (
              <button 
                onClick={startChallenge}
                className="bg-[#00a884] hover:bg-[#008f6f] text-white font-bold py-3 px-8 rounded-full transition-colors flex items-center gap-2 shadow-md text-lg"
              >
                <Play size={24} fill="currentColor" />
                بدء التحدي الآن
              </button>
            ) : (
              <div className="bg-gray-100 text-gray-600 px-6 py-3 rounded-full font-medium">
                في انتظار أدمن الغرفة لبدء اللعبة...
              </div>
            )}
          </div>
        ) : gameState === 'asking' ? (
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm p-8 text-center flex flex-col items-center justify-center min-h-[40vh]">
            {isJudge ? (
              <div className="w-full space-y-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">دورك لكتابة سؤال</h2>
                <textarea
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  placeholder="اكتب سؤالك هنا..."
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-lg min-h-[120px] resize-none"
                />
                <button 
                  onClick={submitQuestion}
                  disabled={!questionInput.trim()}
                  className="w-full bg-[#00a884] hover:bg-[#008f6f] text-white font-bold py-3.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <Send size={20} className="rtl:-scale-x-100" />
                  بدء التحدي
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <h2 className="text-xl font-bold text-gray-800">في انتظار {judgeName} لكتابة السؤال...</h2>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-6">
            {/* Question Card */}
            <div className="bg-white rounded-xl shadow-md p-6 border-t-4 border-[#00a884]">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm font-bold text-[#00a884]">سؤال من: {judgeName}</span>
                {gameState === 'playing' && (
                  <span className={`text-lg font-bold px-3 py-1 rounded-full ${timeLeft <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-700'}`}>
                    {timeLeft} ثانية
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold text-gray-800 leading-relaxed">
                {currentQuestion}
              </h2>
            </div>

            {/* Admin View: Submissions */}
            {isJudge ? (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">إجابات اللاعبين</h3>
                {gameState === 'playing' ? (
                  <p className="text-gray-500 text-center py-4">في انتظار إجابات اللاعبين...</p>
                ) : submissions.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">لم يجب أحد!</p>
                ) : (
                  <div className="space-y-4">
                    {submissions.map((sub, index) => (
                      <div key={`sub-${sub.playerId}-${index}`} className={`border rounded-lg p-4 transition-colors ${sub.judged ? (sub.isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-gray-50'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-gray-800">{sub.playerName}</span>
                          <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded">الرهان: {sub.wager}</span>
                        </div>
                        <p className="text-lg text-gray-900 mb-4 bg-white p-3 rounded border">{sub.answer}</p>
                        
                        {!sub.judged ? (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => judgeAnswer(sub.playerId, true)}
                              className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-2 rounded flex items-center justify-center gap-1 transition-colors"
                            >
                              <Check size={18} /> إجابة صحيحة
                            </button>
                            <button 
                              onClick={() => judgeAnswer(sub.playerId, false)}
                              className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded flex items-center justify-center gap-1 transition-colors"
                            >
                              <X size={18} /> إجابة خاطئة
                            </button>
                          </div>
                        ) : (
                          <div className={`text-center font-bold ${sub.isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                            {sub.isCorrect ? 'تم احتساب النقاط' : 'إجابة خاطئة'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {gameState === 'judging' && submissions.every(s => s.judged) && (
                  <button 
                    onClick={nextTurn}
                    className="w-full mt-6 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold py-3 px-4 rounded-lg transition-colors"
                  >
                    الدور التالي
                  </button>
                )}
              </div>
            ) : (
              /* Player View: Answer Form */
              <div className="bg-white rounded-xl shadow-sm p-6">
                {mySubmission ? (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                      {mySubmission.judged ? (
                        mySubmission.isCorrect ? <Check size={32} className="text-green-500" /> : <X size={32} className="text-red-500" />
                      ) : (
                        <div className="w-8 h-8 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
                      )}
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                      {mySubmission.judged 
                        ? (mySubmission.isCorrect ? 'إجابة صحيحة! كسبت النقاط' : 'إجابة خاطئة! حظ أوفر') 
                        : 'تم إرسال إجابتك'}
                    </h3>
                    <p className="text-gray-500">
                      {mySubmission.judged ? 'في انتظار الدور التالي...' : 'في انتظار تقييم الإجابة...'}
                    </p>
                  </div>
                ) : gameState === 'playing' ? (
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">إجابتك:</label>
                      <input
                        type="text"
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        placeholder="اكتب إجابتك هنا..."
                        className="w-full bg-gray-50 border border-gray-200 text-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-lg"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">اختر نقاط الرهان (1 - 20):</label>
                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2" dir="ltr">
                        {Array.from({ length: 20 }, (_, i) => i + 1).map(num => {
                          const isUsed = usedWagers[userId]?.includes(num);
                          return (
                            <button
                              key={num}
                              onClick={() => setWagerInput(num)}
                              disabled={isUsed}
                              className={`py-2 rounded font-bold transition-colors text-sm ${
                                wagerInput === num 
                                  ? 'bg-[#00a884] text-white shadow-md scale-105' 
                                  : isUsed 
                                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed' 
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-200 border border-gray-200'
                              }`}
                            >
                              {num}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      onClick={submitAnswer}
                      disabled={!answerInput.trim() || usedWagers[userId]?.includes(wagerInput)}
                      className="w-full bg-[#00a884] hover:bg-[#008f6f] text-white font-bold py-3.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                    >
                      <Send size={20} className="rtl:-scale-x-100" />
                      إرسال الإجابة
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-gray-500">انتهى الوقت!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Chat Drawer Overlay */}
      {isChatOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 transition-opacity"
          onClick={() => setIsChatOpen(false)}
        />
      )}

      {/* Chat Drawer */}
      <div 
        className={`fixed top-0 bottom-0 right-0 w-full sm:w-96 bg-[#efeae2] shadow-2xl z-40 transform transition-transform duration-300 ease-in-out flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="bg-[#008069] text-white px-4 py-3 flex items-center justify-between shadow-md shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <MessageSquare size={20} />
            <span className="font-bold text-lg">دردشة الغرفة</span>
          </div>
          <button onClick={() => setIsChatOpen(false)} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
            <ArrowRight size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar flex flex-col">
          {messages.map((msg, index) => {
            const isMe = msg.senderId === userId;
            const isSystem = msg.senderId === 'system';

            if (isSystem) {
              return (
                <div key={`msg-${msg.id}-${index}`} className="flex justify-center my-2">
                  <span className="bg-[#f0f2f5] text-gray-600 text-[11px] px-3 py-1.5 rounded-lg shadow-sm border border-gray-200/50">
                    {msg.text}
                  </span>
                </div>
              );
            }

            return (
              <div key={`msg-${msg.id}-${index}`} className={`flex flex-col max-w-[85%] ${isMe ? 'self-end' : 'self-start'}`}>
                <div 
                  className={`px-3 py-2 shadow-sm relative ${
                    isMe 
                      ? 'bg-[#d9fdd3] rounded-2xl rounded-tl-none' 
                      : 'bg-white rounded-2xl rounded-tr-none'
                  }`}
                >
                  {!isMe && (
                    <div className="text-[12px] font-bold text-[#027eb5] mb-0.5">
                      {msg.senderName}
                    </div>
                  )}
                  <div className="flex items-end gap-2 flex-wrap">
                    <p className="text-[14px] text-[#111b21] leading-relaxed break-words">{msg.text}</p>
                    <span className="text-[9px] text-gray-500 min-w-[40px] text-left mt-1">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="bg-[#f0f2f5] p-2 shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <div className="flex-1 bg-white rounded-3xl flex items-end shadow-sm border border-gray-200 overflow-hidden">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="اكتب رسالة..."
                className="w-full bg-transparent text-[#111b21] px-4 py-3 focus:outline-none text-[14px] max-h-32"
                dir="auto"
              />
            </div>
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="w-11 h-11 shrink-0 bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-50 text-white rounded-full transition-colors flex items-center justify-center shadow-sm mb-0.5"
            >
              <Send size={18} className="rtl:-scale-x-100 mr-1" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
