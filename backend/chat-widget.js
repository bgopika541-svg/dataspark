/* ============================================================
   DATA SPARK — Floating Chat Widget
   Works on all public pages (pro.html, cor.html, abt.html, con.html)
   - AI bot answers common questions
   - "Chat with Admin" option opens a live Socket.IO chat
   ============================================================ */
(function () {
  'use strict';

  /* ── Config ── */
  const API = 'https://dataspark-ggm8.onrender.com';

  /* ── State ── */
  let socket = null;
  let convKey = localStorage.getItem('ds_chat_key');
  if (!convKey) {
    convKey = 'conv_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('ds_chat_key', convKey);
  }
  const dsUser     = localStorage.getItem('ds_user')     || null;
  const dsFullName = localStorage.getItem('ds_fullname') || dsUser || 'Guest';
  const dsEmail    = localStorage.getItem('ds_email')    || '';

  let botState      = 'bot';   // 'bot' | 'live'
  let adminOnline   = false;
  let unreadCount   = 0;
  let widgetOpen    = false;

  /* ── Inject CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    #ds-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9990;
      width: 58px; height: 58px; border-radius: 50%;
      background: linear-gradient(135deg, #1a56ff, #5d8fff);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.5rem; color: #fff;
      box-shadow: 0 8px 28px rgba(26,86,255,0.45);
      transition: transform 0.3s, box-shadow 0.3s;
    }
    #ds-chat-btn:hover { transform: translateY(-3px); box-shadow: 0 12px 36px rgba(26,86,255,0.6); }
    #ds-chat-unread {
      position: absolute; top: -2px; right: -2px;
      background: #ef4444; color: #fff;
      border-radius: 50%; width: 20px; height: 20px;
      font-size: 0.65rem; font-weight: 800;
      display: none; align-items: center; justify-content: center;
      border: 2px solid #fff;
    }
    #ds-chat-window {
      position: fixed; bottom: 96px; right: 24px; z-index: 9989;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 20px;
      box-shadow: 0 16px 60px rgba(0,0,0,0.22);
      display: none; flex-direction: column; overflow: hidden;
      animation: dsChatSlideUp 0.3s ease both;
      font-family: 'Inter', 'DM Sans', sans-serif;
    }
    #ds-chat-window.open { display: flex; }
    @keyframes dsChatSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .ds-chat-header {
      background: linear-gradient(135deg, #1a56ff, #5d8fff);
      padding: 16px 18px; display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    .ds-chat-header-avatar {
      width: 38px; height: 38px; border-radius: 12px;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; flex-shrink: 0;
    }
    .ds-chat-header-info { flex: 1; }
    .ds-chat-header-title { font-weight: 700; font-size: 0.95rem; color: #fff; }
    .ds-chat-header-sub { font-size: 0.75rem; color: rgba(255,255,255,0.75); margin-top: 2px; }
    .ds-chat-header-close {
      background: rgba(255,255,255,0.15); border: none; color: #fff;
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
      font-size: 1rem; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .ds-chat-header-close:hover { background: rgba(255,255,255,0.3); }
    .ds-chat-tab-bar {
      display: flex; border-bottom: 1px solid #e2e8f0; flex-shrink: 0;
    }
    .ds-chat-tab {
      flex: 1; padding: 10px; font-size: 0.8rem; font-weight: 600;
      border: none; background: transparent; cursor: pointer;
      color: #94a3b8; transition: all 0.2s; border-bottom: 2px solid transparent;
    }
    .ds-chat-tab.active { color: #1a56ff; border-bottom-color: #1a56ff; }
    .ds-chat-body {
      flex: 1; overflow-y: auto; padding: 14px 14px 8px;
      display: flex; flex-direction: column; gap: 10px;
      background: #f8fafc;
    }
    .ds-bubble {
      max-width: 80%; padding: 9px 13px; border-radius: 14px;
      font-size: 0.87rem; line-height: 1.5; word-break: break-word;
      animation: dsBubbleIn 0.25s ease both;
    }
    @keyframes dsBubbleIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .ds-bubble.bot  { background: #e0e7ff; color: #1e293b; align-self: flex-start; border-bottom-left-radius: 4px; }
    .ds-bubble.user { background: linear-gradient(135deg,#1a56ff,#5d8fff); color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .ds-bubble.admin { background: #d1fae5; color: #065f46; align-self: flex-start; border-bottom-left-radius: 4px; }
    .ds-bubble.system { background: #fef3c7; color: #92400e; align-self: center; font-size: 0.78rem; border-radius: 8px; text-align: center; }
    .ds-bubble-meta { font-size: 0.68rem; color: rgba(0,0,0,0.35); margin-top: 4px; }
    .ds-bubble.user .ds-bubble-meta { color: rgba(255,255,255,0.6); }
    .ds-quick-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .ds-quick-btn {
      font-size: 0.78rem; padding: 5px 12px; border-radius: 20px;
      border: 1.5px solid rgba(26,86,255,0.3); background: transparent;
      color: #1a56ff; cursor: pointer; transition: all 0.2s;
    }
    .ds-quick-btn:hover { background: #1a56ff; color: #fff; }
    .ds-chat-composer {
      padding: 10px 12px; border-top: 1px solid #e2e8f0;
      display: flex; gap: 8px; flex-shrink: 0; background: #fff;
    }
    .ds-chat-input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 9px 13px; font-size: 0.87rem; outline: none;
      font-family: inherit; resize: none; height: 40px; line-height: 1.4;
      transition: border-color 0.2s;
    }
    .ds-chat-input:focus { border-color: #1a56ff; }
    .ds-chat-send {
      background: linear-gradient(135deg,#1a56ff,#5d8fff);
      color: #fff; border: none; border-radius: 12px;
      padding: 9px 16px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; white-space: nowrap; transition: transform 0.2s;
    }
    .ds-chat-send:hover { transform: translateY(-1px); }
    .ds-chat-mic {
      background: linear-gradient(135deg,#1a56ff,#5d8fff);
      color: #fff; border: none; border-radius: 12px;
      padding: 9px 14px; font-size: 0.95rem;
      cursor: pointer; transition: all 0.2s;
      display: flex; align-items: center; justify-content: center;
    }
    .ds-chat-mic:hover { transform: translateY(-1px); }
    .ds-chat-mic.listening { background: #ef4444; animation: dsMicPulse 1.5s infinite; }
    @keyframes dsMicPulse { 0%,100%{opacity:1;} 50%{opacity:0.6;} }
    .ds-admin-status {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.75rem; padding: 8px 14px;
      background: #f0fdf4; border-bottom: 1px solid #d1fae5;
      color: #065f46; flex-shrink: 0;
    }
    .ds-admin-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #22c55e; animation: dsPulse 1.5s infinite;
    }
    .ds-admin-status-dot.offline { background: #94a3b8; animation: none; }
    @keyframes dsPulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
    .ds-typing { align-self: flex-start; padding: 8px 13px; background: #e0e7ff; border-radius: 14px; border-bottom-left-radius: 4px; }
    .ds-typing span { display: inline-block; width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; margin: 0 2px; animation: dsTyping 1.2s infinite; }
    .ds-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ds-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dsTyping { 0%,60%,100%{transform:translateY(0);} 30%{transform:translateY(-6px);} }
    [data-theme="dark"] #ds-chat-window { background: #0f172a; }
    [data-theme="dark"] .ds-chat-body { background: #0c1228; }
    [data-theme="dark"] .ds-chat-composer { background: #0f172a; border-top-color: rgba(255,255,255,0.08); }
    [data-theme="dark"] .ds-chat-input { background: #1e293b; border-color: rgba(255,255,255,0.1); color: #f1f5f9; }
    [data-theme="dark"] .ds-chat-tab-bar { border-bottom-color: rgba(255,255,255,0.08); }
    [data-theme="dark"] .ds-chat-tab { color: #64748b; }
    [data-theme="dark"] .ds-chat-tab.active { color: #5d8fff; border-bottom-color: #5d8fff; }
    [data-theme="dark"] .ds-bubble.bot { background: #1e293b; color: #e2e8f0; }
    [data-theme="dark"] .ds-bubble.system { background: rgba(245,158,11,0.15); color: #fbbf24; }
    [data-theme="dark"] .ds-admin-status { background: rgba(34,197,94,0.08); border-bottom-color: rgba(34,197,94,0.15); color: #4ade80; }
    @media (max-width: 480px) {
      #ds-chat-window { width: calc(100vw - 24px); right: 12px; bottom: 88px; }
      #ds-chat-btn { bottom: 16px; right: 16px; width: 52px; height: 52px; font-size: 1.3rem; }
    }
  `;
  document.head.appendChild(style);

  /* ── Build HTML ── */
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <button id="ds-chat-btn" aria-label="Open chat">
      💬
      <div id="ds-chat-unread"></div>
    </button>
    <div id="ds-chat-window" role="dialog" aria-label="Chat">
      <div class="ds-chat-header">
        <div class="ds-chat-header-avatar">🤖</div>
        <div class="ds-chat-header-info">
          <div class="ds-chat-header-title" id="ds-header-title">DATA SPARK Assistant</div>
          <div class="ds-chat-header-sub" id="ds-header-sub">Ask me anything!</div>
        </div>
        <button class="ds-chat-header-close" onclick="window.__dsChat.close()">✕</button>
      </div>
      <div class="ds-chat-tab-bar">
        <button class="ds-chat-tab active" id="ds-tab-bot" onclick="window.__dsChat.switchTab('bot')">🤖 AI Assistant</button>
        <button class="ds-chat-tab" id="ds-tab-live" onclick="window.__dsChat.switchTab('live')">💬 Live Chat</button>
      </div>
      <div id="ds-admin-status-bar" class="ds-admin-status" style="display:none;">
        <div class="ds-admin-status-dot" id="ds-admin-dot"></div>
        <span id="ds-admin-status-text">Admin is online</span>
      </div>
      <div class="ds-chat-body" id="ds-chat-body"></div>
      <div class="ds-chat-composer">
        <textarea class="ds-chat-input" id="ds-chat-input" placeholder="Type a message..." rows="1"></textarea>
        <button class="ds-chat-mic" id="ds-chat-mic" onclick="window.__dsChat.toggleMic()" title="Hold to speak">🎤</button>
        <button class="ds-chat-send" onclick="window.__dsChat.send()">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  /* ── DOM refs ── */
  const btnEl        = document.getElementById('ds-chat-btn');
  const windowEl     = document.getElementById('ds-chat-window');
  const bodyEl       = document.getElementById('ds-chat-body');
  const inputEl      = document.getElementById('ds-chat-input');
  const unreadEl     = document.getElementById('ds-chat-unread');
  const tabBot       = document.getElementById('ds-tab-bot');
  const tabLive      = document.getElementById('ds-tab-live');
  const statusBar    = document.getElementById('ds-admin-status-bar');
  const adminDot     = document.getElementById('ds-admin-dot');
  const adminStatus  = document.getElementById('ds-admin-status-text');
  const headerTitle  = document.getElementById('ds-header-title');
  const headerSub    = document.getElementById('ds-header-sub');
  const micBtn       = document.getElementById('ds-chat-mic');

  /* ── Speech Recognition ── */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListening = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListening = true;
      micBtn.classList.add('listening');
      micBtn.textContent = '🎤';
    };

    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      // Update input field with recognized text (don't auto-post)
      inputEl.value = transcript;
    };

    recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      micBtn.classList.remove('listening');
      isListening = false;
    };

    recognition.onend = () => {
      micBtn.classList.remove('listening');
      isListening = false;
      micBtn.textContent = '🎤';
    };
  }

  /* ── Helpers ── */
  function timeStr() {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function addBubble(text, type, meta) {
    const div = document.createElement('div');
    div.className = 'ds-bubble ' + type;
    div.innerHTML = text + (meta ? `<div class="ds-bubble-meta">${meta}</div>` : '');
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return div;
  }

  function addQuickBtns(btns) {
    const wrap = document.createElement('div');
    wrap.className = 'ds-quick-btns';
    btns.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'ds-quick-btn';
      btn.textContent = b.label;
      btn.onclick = () => { wrap.remove(); b.action(); };
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'ds-typing'; t.id = 'ds-typing-indicator';
    t.innerHTML = '<span></span><span></span><span></span>';
    bodyEl.appendChild(t);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return t;
  }

  function removeTyping() {
    const t = document.getElementById('ds-typing-indicator');
    if (t) t.remove();
  }

  function setUnread(n) {
    unreadCount = n;
    if (n > 0 && !widgetOpen) {
      unreadEl.textContent = n > 9 ? '9+' : n;
      unreadEl.style.display = 'flex';
    } else {
      unreadEl.style.display = 'none';
    }
  }

  function updateAdminStatus(online) {
    adminOnline = online;
    statusBar.style.display = botState === 'live' ? 'flex' : 'none';
    adminDot.className = 'ds-admin-status-dot' + (online ? '' : ' offline');
    adminStatus.textContent = online ? 'Admin is online — replies are instant' : 'Admin is offline — we\'ll reply soon';
  }

  /* ── Bot AI replies ── */
  let botChatState = 0; // 0=normal, 1=asked admin, 2=waiting

  function getBotReply(msg) {
    const m = msg.toLowerCase();

    if (botChatState === 1) {
      if (/yes|yeah|sure|ok|yep/.test(m)) {
        botChatState = 2;
        switchToLive(true);
        return null;
      } else if (/no|nope|nah/.test(m)) {
        botChatState = 0;
        return 'No problem! Is there anything else I can help you with?';
      }
      return 'Please reply <strong>Yes</strong> or <strong>No</strong> to connect with an admin.';
    }

    if (/course|program|learn/.test(m))
      return '📚 We offer 16+ courses in Programming, Data & AI, Cloud, Testing, and Design. <a href="cor.html" style="color:#1a56ff;font-weight:600;">View all courses →</a>';
    if (/fee|price|cost|pay/.test(m))
      return '💰 Course fees range from ₹8,000 to ₹25,000. <a href="con.html" style="color:#1a56ff;font-weight:600;">Contact us</a> for exact pricing.';
    if (/placement|job|hire|career/.test(m))
      return '💼 We have a <strong>95% placement rate</strong> with top companies like TCS, Infosys, and Wipro. We provide resume support, mock interviews & referrals!';
    if (/duration|time|long|month/.test(m))
      return '⏱️ Most courses are <strong>1.5 – 4 months</strong> long with flexible morning, evening, and weekend batches.';
    if (/location|address|where|chennai/.test(m))
      return '📍 We are located in <strong>Chennai, Tamil Nadu</strong>. <a href="con.html" style="color:#1a56ff;font-weight:600;">Get directions →</a>';
    if (/contact|phone|call|reach/.test(m))
      return '📞 <strong>+91 98765 43210</strong><br>📧 dataspark@email.com<br>🕐 Mon–Sat, 9AM–7PM';
    if (/certificate|certif/.test(m))
      return '🏆 Yes! All courses include an <strong>industry-recognized certificate</strong> upon completion.';
    if (/enroll|register|apply|join/.test(m))
      return '✅ To enroll, <a href="cor.html" style="color:#1a56ff;font-weight:600;">browse our courses</a> and click <strong>Enroll Now</strong>. You\'ll need to create an account first.';
    if (/hi|hello|hey|hii/.test(m))
      return `👋 Hello${dsUser ? ', ' + dsFullName.split(' ')[0] : ''}! I\'m the DATA SPARK AI assistant. How can I help you today?`;
    if (/thank|thanks/.test(m))
      return '😊 You\'re welcome! Feel free to ask anything else.';
    if (/admin|human|person|staff|support|speak|talk|agent|help me|live chat|real person/.test(m)) {
      botChatState = 1;
      return '🙋 Sure! Would you like me to connect you with a <strong>live admin</strong>? They can answer specific questions in real-time. <strong>(Yes / No)</strong>';
    }
    if (/i want to speak|speak with|talk to|connect me|human support|need help|urgent/.test(m)) {
      botChatState = 2;
      switchToLive(true);
      return null;
    }

    // Unknown — offer admin
    botChatState = 1;
    return '🤔 I\'m not sure about that. Would you like to <strong>chat with a live admin</strong> for a more specific answer? <strong>(Yes / No)</strong>';
  }

  /* ── Socket.IO ── */
  function initSocket() {
    if (socket) return;
    try {
      socket = io(API);

      socket.on('connect', () => {
        // Always join with user name so admin can see who is chatting
        socket.emit('student_join', {
          conversationKey: convKey,
          userId:          dsUser,
          userName:        dsFullName || dsUser || 'Guest',
          userEmail:       dsEmail
        });
      });

      socket.on('admin_status', (data) => { updateAdminStatus(!!data.online); });

      socket.on('receive_msg', (data) => {
        const adminMessage = (data.type === 'file' && data.fileData)
          ? `<img src="${data.fileData}" style="max-width:100%;border-radius:12px;" />`
          : escHtml(data.msg || '');
        if (botState === 'live') {
          removeTyping();
          addBubble(adminMessage, 'admin', (data.name || 'Admin') + ' · ' + timeStr());
        } else {
          setUnread(unreadCount + 1);
          addBubble('💬 <strong>Admin replied:</strong> ' + adminMessage, 'system', timeStr());
        }
      });

      socket.on('adminTyping', () => {
        if (botState === 'live') { removeTyping(); showTyping(); setTimeout(removeTyping, 3000); }
      });

      socket.on('chat_history', (history) => {
        if (!history || !history.length) return;
        history.forEach(m => {
          const who  = m.sender_role === 'admin' ? 'admin' : 'user';
          const name = who === 'admin' ? (m.sender_name || 'Admin') : 'You';
          addBubble(escHtml(m.message || ''), who,
            name + ' · ' + (m.created_at
              ? new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
              : ''));
        });
      });
    } catch (e) {
      console.warn('Chat socket init failed:', e.message);
    }
  }

  // Init socket immediately so user_name is registered as soon as widget loads
  initSocket();

  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Tab switching ── */
  function switchTab(tab) {
    botState = tab;
    tabBot.classList.toggle('active', tab === 'bot');
    tabLive.classList.toggle('active', tab === 'live');
    statusBar.style.display = tab === 'live' ? 'flex' : 'none';

    if (tab === 'bot') {
      headerTitle.textContent = 'DATA SPARK Assistant';
      headerSub.textContent = 'Ask me anything!';
      inputEl.placeholder = 'Ask a question...';
    } else {
      headerTitle.textContent = 'Live Chat — Admin';
      headerSub.textContent = adminOnline ? 'Admin is online' : 'Leave a message';
      inputEl.placeholder = 'Type your message to admin...';
      initSocket();
      updateAdminStatus(adminOnline);
    }
  }

  function switchToLive(showWelcome) {
    switchTab('live');
    if (showWelcome) {
      addBubble('✅ Connecting you to a live admin now. Please type your question below.', 'system', timeStr());
    }
  }

  /* ── Bot init message ── */
  function initBotMessages() {
    bodyEl.innerHTML = '';
    addBubble(`👋 Hi${dsUser ? ' ' + dsFullName.split(' ')[0] : ''}! I\'m the <strong>DATA SPARK AI Assistant</strong>.<br>Ask me about courses, fees, placements, or anything else!`, 'bot', 'AI Bot · ' + timeStr());
    addQuickBtns([
      { label: '📚 Courses',    action: () => handleBotInput('What courses do you offer?') },
      { label: '💰 Fees',       action: () => handleBotInput('What are the fees?') },
      { label: '💼 Placement',  action: () => handleBotInput('Tell me about placement') },
      { label: '💬 Talk to Admin', action: () => switchToLive(true) }
    ]);
  }

  /* ── Send logic ── */
  function handleBotInput(text) {
    addBubble(escHtml(text), 'user', 'You · ' + timeStr());
    const typing = showTyping();
    setTimeout(() => {
      removeTyping();
      const reply = getBotReply(text);
      if (reply) addBubble(reply, 'bot', 'AI Bot · ' + timeStr());
    }, 600);
  }

  function handleLiveInput(text) {
    addBubble(escHtml(text), 'user', 'You · ' + timeStr());
    if (!socket || !socket.connected) {
      initSocket();
      setTimeout(() => emitLiveMsg(text), 800);
    } else {
      emitLiveMsg(text);
    }
  }

  function emitLiveMsg(text) {
    if (!socket) return;
    socket.emit('student_msg', {
      conversationKey: convKey,
      msg: text,
      userName: dsFullName,
      userEmail: dsEmail
    });
  }

  function sendMsg() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';

    if (botState === 'bot') {
      handleBotInput(text);
    } else {
      handleLiveInput(text);
    }
  }

  /* ── Open / Close ── */
  function openWidget() {
    widgetOpen = true;
    windowEl.classList.add('open');
    btnEl.innerHTML = '✕<div id="ds-chat-unread" style="display:none;"></div>';
    setUnread(0);
    if (bodyEl.children.length === 0) initBotMessages();
    inputEl.focus();
    initSocket();
  }

  function closeWidget() {
    widgetOpen = false;
    windowEl.classList.remove('open');
    btnEl.innerHTML = '💬<div id="ds-chat-unread"></div>';
  }

  /* ── Event listeners ── */
  btnEl.addEventListener('click', () => widgetOpen ? closeWidget() : openWidget());

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });

  /* ── Expose public API ── */
  window.__dsChat = {
    open: openWidget,
    close: closeWidget,
    send: sendMsg,
    switchTab,
    toggleMic: () => {
      if (!recognition) {
        alert('Speech recognition not supported in your browser');
        return;
      }
      if (isListening) {
        recognition.stop();
      } else {
        inputEl.focus();
        recognition.start();
      }
    }
  };

})();
