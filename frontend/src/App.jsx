import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, 
  UploadCloud, 
  Send, 
  RefreshCw, 
  FileText, 
  Sparkles, 
  Cpu, 
  HelpCircle, 
  CheckCircle2, 
  AlertCircle,
  FileQuestion,
  Layers,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Lock,
  Mail,
  Search,
  Bell,
  ChevronRight,
  Plus,
  LayoutDashboard,
  Settings,
  MoreVertical,
  PlusCircle,
  Info,
  Sun,
  Moon
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000';

function App() {
  // Navigation State
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'upload' | 'materials' | 'chat' | 'graph'

  // Authentication States
  const [token, setToken] = useState(localStorage.getItem('omnistudy_token') || null);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('omnistudy_user')) || null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // App States
  const [systemStatus, setSystemStatus] = useState({
    hasDocument: false,
    filename: null,
    fileSize: 0,
    chunkCount: 0,
    apiKeyConfigured: false
  });
  
  const [uploadFormTitle, setUploadFormTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState(0); // 0 to 4 steps
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const [askingProgress, setAskingProgress] = useState('');
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);

  // Graph Interaction State
  const [selectedNodeName, setSelectedNodeName] = useState('Supervised Learning');

  // Interactive UI States
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('omnistudy-theme') || 'light');
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omnistudy-theme', theme);
  }, [theme]);

  // Settings Configurations
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [conceptsEnabled, setConceptsEnabled] = useState(true);
  const [customApiKey, setCustomApiKey] = useState('');
  const [userPlan, setUserPlan] = useState('Free Tier');
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingForm, setBillingForm] = useState({
    number: '',
    name: '',
    expiry: '',
    cvv: ''
  });
  const [billingError, setBillingError] = useState(null);

  // Notifications List
  const [notifications, setNotifications] = useState([
    { id: 1, text: 'Machine Learning - Lecture 01.pdf has been successfully indexed.', time: 'Just now' },
    { id: 2, text: 'New concept node map built for your workspace.', time: '5 mins ago' },
    { id: 3, text: 'Account registered successfully. Welcome to OmniStudy!', time: '10 mins ago' }
  ]);

  // Materials Array
  const [materialsList, setMaterialsList] = useState([
    { id: '1', title: 'Machine Learning - Lecture 01.pdf', type: 'PDF', time: '2 days ago', badge: 'PDF' },
    { id: '2', title: 'Data Structures - Trees.pdf', type: 'PDF', time: '5 days ago', badge: 'PDF' },
    { id: '3', title: 'Software Engineering - Agile.pdf', type: 'PDF', time: '1 week ago', badge: 'PDF' }
  ]);

  const getVisibleMaterials = () => {
    let list = [...materialsList];
    if (systemStatus.hasDocument && systemStatus.filename) {
      if (!list.some(m => m.title === systemStatus.filename)) {
        list.unshift({
          id: 'active-file',
          title: systemStatus.filename,
          type: 'PDF',
          time: 'Just now',
          badge: 'active'
        });
      }
    }
    if (searchQuery.trim() !== '') {
      list = list.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return list;
  };

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Sync status on token change
  useEffect(() => {
    if (token) {
      fetchStatus();
    }
  }, [token]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const handleLogout = () => {
    localStorage.removeItem('omnistudy_token');
    localStorage.removeItem('omnistudy_user');
    setToken(null);
    setUser(null);
    setMessages([]);
    setSources([]);
    setError(null);
    setAuthError(null);
    setActiveView('dashboard');
    setSystemStatus({
      hasDocument: false,
      filename: null,
      fileSize: 0,
      chunkCount: 0,
      apiKeyConfigured: false
    });
  };

  const handleAuthChange = (e) => {
    setAuthForm({
      ...authForm,
      [e.target.name]: e.target.value
    });
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
    const payload = isRegistering 
      ? { name: authForm.name, email: authForm.email, password: authForm.password }
      : { email: authForm.email, password: authForm.password };

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed.');
      }

      localStorage.setItem('omnistudy_token', data.token);
      localStorage.setItem('omnistudy_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ name: '', email: '', password: '' });
      setActiveView('dashboard');
      
    } catch (err) {
      console.error(err);
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch backend status.');
      const data = await res.json();
      setSystemStatus(data);
      if (!data.apiKeyConfigured) {
        setError('Google Gemini API Key is missing. Please configure GEMINI_API_KEY in the backend .env file.');
      } else {
        setError(null);
      }
    } catch (err) {
      console.error(err);
      setError('Cannot connect to the backend server. Make sure the Node.js server is running on http://localhost:5000');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (uploading) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const triggerFileSelect = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const processFile = async (file) => {
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are supported.');
      return;
    }

    setUploading(true);
    setUploadStep(1);
    setError(null);
    
    // Animate the stepper checklist during process
    const stepIntervals = [
      setTimeout(() => setUploadStep(2), 1500), // Step 2 active
      setTimeout(() => setUploadStep(3), 3000), // Step 3 active
      setTimeout(() => setUploadStep(4), 4500), // Step 4 active
    ];

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to upload and parse PDF.');
      }

      const data = await res.json();
      
      // Wait briefly on final step to let user see it complete
      setTimeout(() => {
        setSystemStatus({
          hasDocument: true,
          filename: data.filename,
          fileSize: file.size,
          chunkCount: data.chunkCount,
          apiKeyConfigured: true
        });

        // Add real-time notification
        setNotifications(prev => [
          { id: Date.now(), text: `${data.filename} has been successfully indexed.`, time: 'Just now' },
          ...prev
        ]);
        setUnreadNotifications(true);
        
        setMessages([
          { 
            sender: 'assistant', 
            text: `Hi ${user.name}! I've loaded your material "${data.filename}" and vector-indexed ${data.chunkCount} chunks. Ask me any question based on this lecture material, or explore the concept map in the Knowledge Graph!` 
          }
        ]);
        setSources([]);
        setUploadFormTitle('');
        setUploading(false);
        setActiveView('dashboard');
      }, 5500);

    } catch (err) {
      console.error(err);
      setError(err.message);
      // Clean intervals
      stepIntervals.forEach(clearTimeout);
      setUploading(false);
    }
  };

  const handleSendQuery = async (e) => {
    e.preventDefault();
    if (!query.trim() || asking) return;

    const userMessage = query.trim();
    setQuery('');
    setMessages(prev => [...prev, { sender: 'user', text: userMessage }]);
    setAsking(true);
    setAskingProgress('Retrieving matching contexts...');

    try {
      setTimeout(() => {
        setAskingProgress('Synthesizing answer using Gemini...');
      }, 1200);

      const res = await fetch(`${API_BASE_URL}/api/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: userMessage })
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate answer.');
      }

      const data = await res.json();
      
      setMessages(prev => [...prev, { sender: 'assistant', text: data.answer }]);
      setSources(data.sources || []);
      
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        sender: 'assistant', 
        text: `Sorry, I encountered an error: ${err.message}` 
      }]);
    } finally {
      setAsking(false);
      setAskingProgress('');
    }
  };

  const handleClear = async () => {
    if (window.confirm("Are you sure you want to clear the current document and start over?")) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/clear`, { 
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401 || res.status === 403) {
          handleLogout();
          return;
        }

        setSystemStatus({
          hasDocument: false,
          filename: null,
          fileSize: 0,
          chunkCount: 0,
          apiKeyConfigured: true
        });
        setMessages([]);
        setSources([]);
        setError(null);
      } catch (err) {
        console.error(err);
        setError('Failed to clear cached document.');
      }
    }
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const getStatusDisplay = () => {
    if (error && error.includes('Cannot connect')) {
      return { text: 'Server Offline', class: 'inactive' };
    }
    if (error && error.includes('API Key is missing')) {
      return { text: 'Key Missing', class: 'inactive' };
    }
    if (systemStatus.hasDocument) {
      return { text: 'Document Active', class: 'active' };
    }
    return { text: 'Ready for Upload', class: 'active' };
  };

  const statusDisplay = getStatusDisplay();

  // Knowledge Graph Data
  const nodesData = {
    'Machine Learning': {
      name: 'Machine Learning',
      definition: 'A subset of artificial intelligence that involves training computer systems to learn patterns from data and make predictions or decisions with minimal human intervention.',
      related: ['Supervised Learning', 'Unsupervised Learning', 'Neural Networks'],
      insights: 'This is the foundational unit of the course. Understanding this mapping is critical for all subsequent modules and quizzes.',
      badge: 'Root Domain'
    },
    'Supervised Learning': {
      name: 'Supervised Learning',
      definition: 'A machine learning approach where a model learns from labeled training data. The algorithm is given examples of inputs and their desired outputs, learning to map inputs to outputs.',
      related: ['Classification', 'Regression', 'Decision Trees'],
      insights: 'This concept is heavily tested in upcoming exams. Consider reviewing the practical applications in Python using scikit-learn.',
      badge: 'Selected Concept'
    },
    'Classification': {
      name: 'Classification',
      definition: 'A supervised learning task where the model predicts discrete class labels. Examples include email spam detection, credit default risk, or handwritten digit recognition.',
      related: ['Supervised Learning', 'Decision Trees', 'Regression'],
      insights: 'Expect coding exercises on binary and multi-class classification in Homework 2.',
      badge: 'Task Node'
    },
    'Regression': {
      name: 'Regression',
      definition: 'A supervised learning task where the model predicts continuous numerical values. Examples include predicting house prices, temperature, or stock trends.',
      related: ['Supervised Learning', 'Classification', 'Gradient Descent'],
      insights: 'Focus on understanding the loss function (Mean Squared Error) and how gradient descent updates coefficients.',
      badge: 'Task Node'
    },
    'Decision Trees': {
      name: 'Decision Trees',
      definition: 'A non-parametric supervised learning method used for classification and regression. It structures decisions as a tree of nodes (tests), branches (outcomes), and leaves (labels).',
      related: ['Supervised Learning', 'Classification', 'Random Forests'],
      insights: 'Important for understanding ensemble learning (boosting/bagging) in later lectures.',
      badge: 'Algorithm Node'
    },
    'Neural Networks': {
      name: 'Neural Networks',
      definition: 'A series of algorithms that endeavors to recognize underlying relationships in a set of data through a process that mimics the way the human brain operates.',
      related: ['Machine Learning', 'Decision Trees', 'Deep Learning'],
      insights: 'This topic will be covered extensively in Module 4. Previewing activation functions (ReLU, Sigmoid) is recommended.',
      badge: 'Architecture Node'
    }
  };

  const selectedNode = nodesData[selectedNodeName] || nodesData['Supervised Learning'];

  const handleHeaderSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!systemStatus.hasDocument) {
      alert('Please upload a lecture document first before searching!');
      return;
    }

    const userMessage = searchQuery.trim();
    setSearchQuery('');
    setQuery('');
    setActiveView('chat');
    setMessages(prev => [...prev, { sender: 'user', text: userMessage }]);
    setAsking(true);
    setAskingProgress('Retrieving matching contexts...');

    try {
      setTimeout(() => {
        setAskingProgress('Synthesizing answer using Gemini...');
      }, 1200);

      const res = await fetch(`${API_BASE_URL}/api/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: userMessage })
      });

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate answer.');
      }

      const data = await res.json();
      
      setMessages(prev => [...prev, { sender: 'assistant', text: data.answer }]);
      setSources(data.sources || []);
      
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        sender: 'assistant', 
        text: `Sorry, I encountered an error: ${err.message}` 
      }]);
    } finally {
      setAsking(false);
      setAskingProgress('');
    }
  };

  const handleConceptChatTrigger = (conceptName) => {
    setActiveView('chat');
    setQuery(`Explain the concept of "${conceptName}" based on our lecture notes.`);
  };

  // RENDER: Authentication Page (Login/Register)
  if (!token) {
    return (
      <div className="login-wrapper">
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '24px',
          padding: '2.5rem',
          maxWidth: '450px',
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
          animation: 'fadeIn 0.4s ease-out'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', textAlign: 'center' }}>
            <div style={{ background: 'var(--primary-light)', width: '52px', height: '52px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', border: '1px solid rgba(37, 99, 235, 0.1)', color: 'var(--primary)' }}>
              <BookOpen size={24} style={{ filter: 'drop-shadow(0 0 4px var(--primary-glow))' }} />
            </div>
            <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              OmniStudy AI
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {isRegistering ? 'Create your account to get started' : 'Sign in to access your lecture workspace'}
            </p>
          </div>

          {authError && (
            <div style={{
              background: 'var(--accent-rose-light)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '10px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--accent-rose)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {isRegistering && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Full Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    name="name"
                    required
                    value={authForm.name}
                    onChange={handleAuthChange}
                    placeholder="Enter your name"
                    className="text-input"
                    style={{ paddingLeft: '38px' }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                <input 
                  type="email" 
                  name="email"
                  required
                  value={authForm.email}
                  onChange={handleAuthChange}
                  placeholder="name@gmail.com"
                  className="text-input"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  name="password"
                  required
                  value={authForm.password}
                  onChange={handleAuthChange}
                  placeholder="Min. 6 characters"
                  className="text-input"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="action-btn-primary" 
              disabled={authLoading}
              style={{ height: '46px', marginTop: '0.5rem', display: 'flex', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}
            >
              {authLoading ? (
                <div className="spinner" style={{ width: '18px', height: '18px', borderTopColor: '#ffffff' }}></div>
              ) : isRegistering ? (
                <>
                  <UserPlus size={18} />
                  Create Account
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {isRegistering ? (
              <span>
                Already have an account?{' '}
                <button 
                  onClick={() => { setIsRegistering(false); setAuthError(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Sign In
                </button>
              </span>
            ) : (
              <span>
                Don't have an account yet?{' '}
                <button 
                  onClick={() => { setIsRegistering(true); setAuthError(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Create one here
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // RENDER: Main Workspace Dashboard (Logged In)
  return (
    <div className="app-wrapper">
      
      {/* 1. Left Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BookOpen size={24} className="sidebar-logo" />
          <div className="brand-info">
            <h2>OmniStudy AI</h2>
            <p>University Portal</p>
          </div>
        </div>

        {/* Quick Action: Upload */}
        <div className="sidebar-action">
          <button 
            onClick={() => { if (!uploading) setActiveView('upload'); }} 
            className="action-btn-primary"
            disabled={uploading}
          >
            <Plus size={16} />
            Upload
          </button>
        </div>

        {/* Nav list */}
        <nav className="sidebar-nav">
          <button 
            onClick={() => setActiveView('dashboard')} 
            className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`}
          >
            <LayoutDashboard size={18} className="nav-icon" />
            Dashboard
          </button>
          
          <button 
            onClick={() => setActiveView('materials')} 
            className={`nav-item ${activeView === 'materials' ? 'active' : ''}`}
          >
            <FileText size={18} className="nav-icon" />
            My Materials
          </button>
          
          <button 
            onClick={() => { if (systemStatus.hasDocument) setActiveView('chat'); else alert('Please upload a lecture document first!'); }} 
            className={`nav-item ${activeView === 'chat' ? 'active' : ''}`}
          >
            <Sparkles size={18} className="nav-icon" />
            AI Chat
          </button>
          
          <button 
            onClick={() => setActiveView('graph')} 
            className={`nav-item ${activeView === 'graph' ? 'active' : ''}`}
          >
            <Layers size={18} className="nav-icon" />
            Knowledge Graph
          </button>
        </nav>

        {/* Footer Nav */}
        <div className="sidebar-footer">
          <button 
            onClick={() => setActiveView('settings')} 
            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
          >
            <Settings size={18} className="nav-icon" />
            Settings
          </button>
          
          <button onClick={handleLogout} className="nav-item logout-item">
            <LogOut size={18} className="nav-icon" style={{ color: 'var(--accent-rose)' }} />
            Logout
          </button>
        </div>
      </aside>

      {/* 2. Main content area (Header + Body router) */}
      <div className="main-workspace">
        <header className="workspace-header">
          {/* Search bar placeholder */}
          <form onSubmit={handleHeaderSearchSubmit} className="header-search">
            <Search 
              size={16} 
              className="header-search-icon" 
              onClick={handleHeaderSearchSubmit}
              style={{ cursor: 'pointer' }}
            />
            <input 
              type="text" 
              placeholder="Search knowledge base..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>

          <div className="header-actions-wrapper">
            <button 
              className="header-icon-btn" 
              title={theme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              style={{ cursor: 'pointer' }}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            <button 
              className="header-icon-btn" 
              title="Notifications"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowHelp(false);
                setShowProfileDropdown(false);
                setUnreadNotifications(false);
              }}
            >
              <Bell size={18} />
              {unreadNotifications && <span className="icon-badge"></span>}
            </button>
            
            <button 
              className="header-icon-btn" 
              title="Help Portal"
              onClick={() => {
                setShowHelp(!showHelp);
                setShowNotifications(false);
                setShowProfileDropdown(false);
              }}
            >
              <HelpCircle size={18} />
            </button>

            {/* Profile Avatar */}
            {user && (
              <div className="header-profile" style={{ position: 'relative' }}>
                <div 
                  className="profile-avatar" 
                  title="Profile Menu"
                  onClick={() => {
                    setShowProfileDropdown(!showProfileDropdown);
                    setShowNotifications(false);
                    setShowHelp(false);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>

                {showProfileDropdown && (
                  <div className="floating-dropdown-card" style={{ right: 0, top: '48px', width: '180px', padding: '0' }}>
                    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                      <p style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</p>
                      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                    </div>
                    <div style={{ padding: '0.25rem' }}>
                      <button 
                        onClick={() => {
                          setActiveView('settings');
                          setShowProfileDropdown(false);
                        }}
                        className="dropdown-list-item"
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.5rem', 
                          width: '100%', 
                          padding: '0.55rem 0.75rem', 
                          fontSize: '0.78rem',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <User size={14} />
                        Profile Settings
                      </button>
                      
                      <button 
                        onClick={() => {
                          handleLogout();
                          setShowProfileDropdown(false);
                        }}
                        className="dropdown-list-item"
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.5rem', 
                          width: '100%', 
                          padding: '0.55rem 0.75rem', 
                          fontSize: '0.78rem',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          color: 'var(--accent-rose)'
                        }}
                      >
                        <LogOut size={14} />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 1. Notifications Floating Dropdown */}
            {showNotifications && (
              <div className="floating-dropdown-card">
                <div className="dropdown-header-row">
                  <h4>Notifications</h4>
                  <button 
                    onClick={() => {
                      setNotifications([]);
                      setUnreadNotifications(false);
                    }} 
                    className="dropdown-clear-btn"
                  >
                    Clear All
                  </button>
                </div>
                <div className="dropdown-list">
                  {notifications.length === 0 ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                      No new notifications
                    </span>
                  ) : (
                    notifications.map(n => (
                      <div 
                        key={n.id} 
                        className="dropdown-item-notify"
                        onClick={() => {
                          if (n.text.includes('indexed')) {
                            setActiveView('chat');
                          } else if (n.text.includes('concept node')) {
                            setActiveView('graph');
                          } else if (n.text.includes('student') || n.text.includes('Premium')) {
                            setActiveView('settings');
                          }
                          setShowNotifications(false);
                        }}
                      >
                        <span className="notify-bullet"></span>
                        <div>
                          <p>{n.text}</p>
                          <span className="notify-time">{n.time}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 2. Help Portal Floating Dropdown */}
            {showHelp && (
              <div className="floating-dropdown-card help">
                <div className="dropdown-header-row">
                  <h4>Help Center & FAQ</h4>
                </div>
                <div className="dropdown-list">
                  <div className="help-faq-item">
                    <span className="help-faq-q">Q: How do I query my slides?</span>
                    <span className="help-faq-a">
                      Click "+ Upload" in the sidebar to index a PDF. Once processed, head over to the "AI Chat" view to start querying your notes.
                    </span>
                  </div>
                  <div className="help-faq-item">
                    <span className="help-faq-q">Q: What is the Knowledge Graph?</span>
                    <span className="help-faq-a">
                      It is an interactive concept map of course topics. Click nodes on the graph to inspect definitions and review key related exam insights.
                    </span>
                  </div>
                  <div className="help-faq-item">
                    <span className="help-faq-q">Q: Can I load custom API Keys?</span>
                    <span className="help-faq-a">
                      Yes! Go to the "Settings" page in the sidebar footer and supply your custom Google Gemini API key to override the server default.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main content scroll container */}
        <div className="workspace-content">
          
          {/* Error alerts banner */}
          {error && (
            <div style={{
              background: 'var(--accent-rose-light)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '10px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              color: 'var(--accent-rose)',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              animation: 'fadeIn 0.3s ease-out'
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* ====================================================================
              ROUTER VIEWS
             ==================================================================== */}
          
          {/* VIEW: Dashboard */}
          {activeView === 'dashboard' && (
            <div className="dashboard-grid">
              
              {/* Dashboard Left Side Column */}
              <div className="dashboard-left">
                <div className="greeting-section">
                  <h2>Welcome back, {user ? user.name : 'Alex'}.</h2>
                  <p>Ready to dive into your materials?</p>
                </div>

                {/* Big upload CTA Box */}
                {!systemStatus.hasDocument ? (
                  <div className="upload-promo-card">
                    <div className="upload-card-icon">
                      <UploadCloud size={28} />
                    </div>
                    <h3>Upload New Material</h3>
                    <p>Drop your PDFs, lecture notes, or syllabus here to instantly generate summaries, flashcards, and graph nodes.</p>
                    <button onClick={() => setActiveView('upload')} className="action-btn-primary" style={{ width: 'auto', padding: '0.6rem 1.5rem' }}>
                      + Select Files
                    </button>
                  </div>
                ) : (
                  /* Active Document Info Card */
                  <div className="upload-promo-card" style={{ border: '1px solid rgba(16, 185, 129, 0.25)', background: 'var(--accent-emerald-light)', padding: '2rem' }}>
                    <div className="upload-card-icon" style={{ background: 'var(--accent-emerald-light)', color: 'var(--accent-emerald)', border: 'none' }}>
                      <CheckCircle2 size={28} />
                    </div>
                    <h3 style={{ fontSize: '1.15rem' }}>Active Document Loaded</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      You are currently studying: <strong>{systemStatus.filename}</strong> ({systemStatus.chunkCount} vector chunks, {formatBytes(systemStatus.fileSize)})
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                      <button onClick={() => setActiveView('chat')} className="action-btn-primary" style={{ width: 'auto', padding: '0.5rem 1.25rem' }}>
                        Open AI Chat
                      </button>
                      <button onClick={handleClear} className="btn-secondary">
                        Clear File
                      </button>
                    </div>
                  </div>
                )}

                {/* Recent Materials Listing */}
                <div className="recent-section">
                  <div className="section-title-row">
                    <h3>Recent Materials</h3>
                    <button onClick={() => setActiveView('materials')} className="section-link-btn">View All</button>
                  </div>

                  <div className="materials-grid">
                    {getVisibleMaterials().length === 0 ? (
                      <div style={{ gridColumn: 'span 3', textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                        <FileQuestion size={36} style={{ margin: '0 auto 0.5rem auto' }} />
                        <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>No matching materials found</p>
                      </div>
                    ) : (
                      getVisibleMaterials().map(m => (
                        <div 
                          key={m.id} 
                          className="material-card" 
                          onClick={() => {
                            if (m.badge === 'active') {
                              setActiveView('chat');
                            } else {
                              setActiveView('graph');
                              if (m.title.includes('Trees')) setSelectedNodeName('Decision Trees');
                              else if (m.title.includes('Agile')) setSelectedNodeName('Regression');
                              else setSelectedNodeName('Supervised Learning');
                            }
                          }}
                        >
                          <div className="material-card-top">
                            <div className={`file-type-icon ${m.badge === 'active' ? 'pdf' : 'pdf'}`}>
                              <FileText size={18} />
                            </div>
                            <button className="header-icon-btn" onClick={(e) => { e.stopPropagation(); if (m.badge === 'active') handleClear(); else alert('Delete action only valid for active workspace'); }} title="Delete">
                              <MoreVertical size={16} />
                            </button>
                          </div>
                          <h4>{m.title}</h4>
                          <div className="material-card-footer">
                            <span>{m.time}</span>
                            <span className={`material-badge ${m.badge === 'active' ? 'pdf' : ''}`} style={m.badge !== 'active' ? { backgroundColor: '#f1f5f9', color: '#64748b' } : {}}>
                              {m.badge}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

              {/* Dashboard Right Side Column (Quick Access) */}
              <div className="dashboard-right">
                <div className="section-title-row">
                  <h3>Quick Access</h3>
                </div>

                <div 
                  className="quick-card" 
                  onClick={() => { if (systemStatus.hasDocument) setActiveView('chat'); else setActiveView('upload'); }}
                >
                  <div className="quick-card-header">
                    <span className="quick-badge">Study Assist</span>
                    <Sparkles size={14} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="quick-card-body">
                    <div className="quick-card-icon">
                      <Sparkles size={18} />
                    </div>
                    <div className="quick-card-text">
                      <h4>AI Chat</h4>
                      <p>
                        {systemStatus.hasDocument 
                          ? `Query notes from: "${systemStatus.filename.slice(0, 18)}..."` 
                          : 'Upload a lecture slides document to ask questions.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="quick-card" onClick={() => setActiveView('graph')}>
                  <div className="quick-card-header">
                    <span className="quick-badge">Visual Tool</span>
                    <Layers size={14} style={{ color: 'var(--accent-emerald)' }} />
                  </div>
                  <div className="quick-card-body">
                    <div className="quick-card-icon graph">
                      <Layers size={18} />
                    </div>
                    <div className="quick-card-text">
                      <h4>Knowledge Graph</h4>
                      <p>Explore automatically extracted lecture concepts and topics graphically.</p>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* VIEW: Upload Form (or Processing Timeline screen) */}
          {activeView === 'upload' && (
            <div className="upload-view-container">
              
              {!uploading ? (
                /* The Form Panel */
                <>
                  <div className="view-header-section">
                    <h2>Upload Learning Material</h2>
                    <p>Upload lecture slides, notes, or PDF materials to start learning with OmniStudy AI.</p>
                  </div>

                  <div className="upload-form-card">
                    <div className="form-group">
                      <label>Material Title <span>*</span></label>
                      <input 
                        type="text" 
                        value={uploadFormTitle}
                        onChange={(e) => setUploadFormTitle(e.target.value)}
                        placeholder="e.g., Intro to Quantum Physics - Chapter 1"
                        className="text-input"
                      />
                    </div>

                    <div className="form-group">
                      <label>Files <span>*</span></label>
                      <div 
                        className="form-dropzone" 
                        onDragOver={handleDragOver} 
                        onDrop={handleDrop}
                        onClick={triggerFileSelect}
                      >
                        <div className="form-dropzone-icon">
                          <UploadCloud size={22} />
                        </div>
                        <div>
                          <h4>Drag and drop your files here</h4>
                          <p>or click to browse local files</p>
                        </div>
                        <p style={{ fontSize: '0.7rem' }}>Supported: PDF (Max 10MB)</p>
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          className="hidden-file-input" 
                          accept="application/pdf"
                          onChange={handleFileSelect}
                        />
                      </div>
                    </div>

                    <div className="form-actions">
                      <button onClick={() => setActiveView('dashboard')} className="btn-secondary">
                        Cancel
                      </button>
                      <button 
                        onClick={triggerFileSelect} 
                        className="action-btn-primary" 
                        style={{ width: 'auto', padding: '0.65rem 1.5rem' }}
                      >
                        Upload Material
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Stepper Progress Checklist Screen */
                <div className="processing-card">
                  <div className="processing-card-header">
                    <div className="spinner" style={{ width: '40px', height: '40px', borderTopColor: 'var(--primary)', marginBottom: '0.5rem' }}></div>
                    <h2>Processing Material</h2>
                    <p>We're processing your material. This may take a moment, but you can leave this page; we'll notify you when it's ready.</p>
                  </div>

                  <div className="processing-file-bar">
                    <div className="processing-file-info">
                      <FileText size={18} className="processing-file-icon" />
                      <div className="processing-file-text">
                        <h4>{uploadFormTitle || 'Lecture Document.pdf'}</h4>
                        <p>PDF Document</p>
                      </div>
                    </div>
                    <div className="processing-file-percent">
                      {uploadStep === 1 && '20%'}
                      {uploadStep === 2 && '50%'}
                      {uploadStep === 3 && '75%'}
                      {uploadStep === 4 && '95%'}
                    </div>
                  </div>

                  {/* Stepper Checklist */}
                  <div className="timeline-stepper">
                    <div className={`timeline-step ${uploadStep >= 1 ? (uploadStep > 1 ? 'completed' : 'active') : ''}`}>
                      <span className="step-indicator">
                        {uploadStep > 1 ? '✓' : '1'}
                      </span>
                      <div className="step-details">
                        <h4>File Uploaded</h4>
                        <p>Successfully transferred to secure storage.</p>
                      </div>
                    </div>

                    <div className={`timeline-step ${uploadStep >= 2 ? (uploadStep > 2 ? 'completed' : 'active') : ''}`}>
                      <span className="step-indicator">
                        {uploadStep > 2 ? '✓' : '2'}
                      </span>
                      <div className="step-details">
                        <h4>Processing Document</h4>
                        <p>Analyzing text and structure...</p>
                      </div>
                    </div>

                    <div className={`timeline-step ${uploadStep >= 3 ? (uploadStep > 3 ? 'completed' : 'active') : ''}`}>
                      <span className="step-indicator">
                        {uploadStep > 3 ? '✓' : '3'}
                      </span>
                      <div className="step-details">
                        <h4>Extracting Concepts</h4>
                        <p>Identifying key terms and definitions.</p>
                      </div>
                    </div>

                    <div className={`timeline-step ${uploadStep >= 4 ? (uploadStep > 4 ? 'completed' : 'active') : ''}`}>
                      <span className="step-indicator">
                        {uploadStep > 4 ? '✓' : '4'}
                      </span>
                      <div className="step-details">
                        <h4>Building Knowledge Graph</h4>
                        <p>Mapping relationships between entities.</p>
                      </div>
                    </div>

                    <div className={`timeline-step ${uploadStep === 4 ? 'active' : ''}`}>
                      <span className="step-indicator">5</span>
                      <div className="step-details">
                        <h4>Preparing AI Knowledge Base</h4>
                        <p>Finalizing indices for intelligent search.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* VIEW: My Materials List */}
          {activeView === 'materials' && (
            <div className="materials-view-container">
              <div className="view-header-section">
                <h2>My Materials</h2>
                <p>Manage all your uploaded lecture courses and study slides.</p>
              </div>

              <div className="materials-grid">
                {getVisibleMaterials().length === 0 ? (
                  <div style={{ gridColumn: 'span 3', textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                    <FileQuestion size={40} style={{ margin: '0 auto 1rem auto', color: 'var(--text-muted)' }} />
                    <h4>No matching materials found</h4>
                    <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Try clearing the search query or uploading a new file.</p>
                  </div>
                ) : (
                  getVisibleMaterials().map(m => (
                    <div 
                      key={m.id} 
                      className="material-card" 
                      onClick={() => {
                        if (m.badge === 'active') {
                          setActiveView('chat');
                        } else {
                          setActiveView('graph');
                          if (m.title.includes('Trees')) setSelectedNodeName('Decision Trees');
                          else if (m.title.includes('Agile')) setSelectedNodeName('Regression');
                          else setSelectedNodeName('Supervised Learning');
                        }
                      }}
                    >
                      <div className="material-card-top">
                        <div className={`file-type-icon ${m.badge === 'active' ? 'pdf' : 'pdf'}`}>
                          <FileText size={18} />
                        </div>
                        <button className="header-icon-btn" onClick={(e) => { e.stopPropagation(); if (m.badge === 'active') handleClear(); else alert('Delete action only valid for active workspace'); }} title="Delete">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                      <h4>{m.title}</h4>
                      <div className="material-card-footer">
                        <span>{m.time}</span>
                        <span className={`material-badge ${m.badge === 'active' ? 'pdf' : ''}`} style={m.badge !== 'active' ? { backgroundColor: '#f1f5f9', color: '#64748b' } : {}}>
                          {m.badge}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* VIEW: AI Chat (RAG) */}
          {activeView === 'chat' && (
            <div className="chat-layout-three-col">
              
              {/* Column 2: Chat Sub-sidebar (Context & Recent list) */}
              <div className="chat-sub-sidebar">
                {/* Context Selector */}
                <div className="sub-sidebar-section">
                  <span className="sub-sidebar-label">Context Selector</span>
                  <div className="context-select-box">
                    <FileText size={14} className="recent-chat-icon" style={{ color: 'var(--primary)' }} />
                    <span title={systemStatus.filename}>{systemStatus.filename || 'No document loaded'}</span>
                    <ChevronRight size={12} style={{ transform: 'rotate(90deg)', color: 'var(--text-muted)' }} />
                  </div>
                </div>

                {/* Recent Chats list */}
                <div className="sub-sidebar-section" style={{ flex: 1, minHeight: 0 }}>
                  <span className="sub-sidebar-label">Recent Chats</span>
                  <div className="recent-chats-list">
                    <button className="recent-chat-item active">
                      <Sparkles size={14} className="recent-chat-icon" />
                      <span>Supervised vs Unsupervised</span>
                    </button>
                    <button className="recent-chat-item" onClick={() => handleConceptChatTrigger('Gradient Descent')}>
                      <Sparkles size={14} className="recent-chat-icon" />
                      <span>Gradient Descent Basics</span>
                    </button>
                    <button className="recent-chat-item" onClick={() => handleConceptChatTrigger('Neural Networks')}>
                      <Sparkles size={14} className="recent-chat-icon" />
                      <span>Neural Networks Intro</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Column 3: Chat Main Area */}
              <div className="chat-main-area">
                <div className="chat-main-header">
                  Currently chatting with: <strong>{systemStatus.filename}</strong>
                </div>

                {/* Main body content area */}
                {messages.length > 0 && !asking ? (
                  /* Redesigned Query Result View */
                  <div className="query-result-view">
                    <span className="query-result-label">Knowledge Query</span>
                    <h2 className="query-result-title">
                      {messages.filter(m => m.sender === 'user').slice(-1)[0]?.text || 'What is supervised learning?'}
                    </h2>

                    {/* AI Synthesis Card */}
                    <div className="synthesis-card">
                      <div className="synthesis-card-header">
                        <Sparkles size={16} className="synthesis-card-icon" />
                        <h4>OmniStudy AI Synthesis</h4>
                      </div>
                      <div className="synthesis-card-body">
                        {messages[messages.length - 1]?.text.split('\n').map((para, pIdx) => (
                          <p key={pIdx}>{para}</p>
                        ))}
                      </div>
                      <div className="synthesis-card-footer">
                        <button 
                          onClick={() => { setMessages([]); setSources([]); setQuery(''); }} 
                          className="action-btn-primary" 
                          style={{ width: 'auto', padding: '0.55rem 1.15rem', fontSize: '0.82rem' }}
                        >
                          Ask Another Question
                        </button>
                        <button onClick={() => alert('Note saved to workspace!')} className="btn-secondary" style={{ padding: '0.55rem 1.15rem', fontSize: '0.82rem' }}>
                          Save Note
                        </button>
                      </div>
                    </div>

                    {/* Sources & References bottom list */}
                    {sources.length > 0 && (
                      <div className="sources-section">
                        <h3>Sources & References</h3>
                        <p>Ground truth documents used to generate this response.</p>
                        <div className="sources-grid-layout">
                          {sources.map((source, index) => (
                            <div key={source.id} className="source-card-ref">
                              <div className="source-card-ref-top">
                                <div className="source-card-ref-title">
                                  <FileText size={14} className="source-card-ref-icon" />
                                  <span>{systemStatus.filename}</span>
                                </div>
                                <span className="material-badge" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', border: 'none' }}>Page {source.page}</span>
                              </div>
                              <div className="source-card-ref-body">
                                "{source.text}"
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Standard Chat Feed (Welcome / Loading / Chat Stream) */
                  <div className="chat-messages-area">
                    {messages.length === 0 ? (
                      <div className="chat-welcome-light">
                        <div className="chat-welcome-icon-box">
                          <Sparkles size={24} />
                        </div>
                        <h3>Ask OmniStudy AI</h3>
                        <p>Type a question in the chat bar to query your uploaded lecture files.</p>
                      </div>
                    ) : (
                      messages.map((msg, index) => (
                        <div key={index} className={`chat-bubble-wrapper ${msg.sender}`}>
                          <div className="chat-bubble-avatar">
                            {msg.sender === 'user' ? 'U' : <Sparkles size={14} />}
                          </div>
                          <div className="chat-bubble-text">
                            <p>{msg.text}</p>
                          </div>
                        </div>
                      ))
                    )}

                    {asking && (
                      <div className="chat-bubble-wrapper assistant">
                        <div className="chat-bubble-avatar">
                          <Sparkles size={14} />
                        </div>
                        <div className="chat-bubble-text" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
                          <div className="typing-bubble">
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                          </div>
                          <div className="chat-status-steps">
                            <Cpu size={12} style={{ animation: 'spin 2s linear infinite' }} />
                            <span>{askingProgress}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {/* Floating Chat Input bar */}
                <div className="chat-input-area-three-col">
                  <form onSubmit={handleSendQuery} className="chat-input-wrapper">
                    <button type="button" className="btn-utility" style={{ padding: '0.5rem', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Attach File">
                      <PlusCircle size={18} />
                    </button>
                    <input 
                      type="text" 
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Ask a question about your materials..."
                      className="chat-text-input"
                      disabled={asking}
                    />
                    <button 
                      type="submit" 
                      className="chat-send-btn" 
                      disabled={!query.trim() || asking}
                    >
                      <Send size={16} />
                    </button>
                  </form>
                  <span className="chat-disclaimer">
                    OmniStudy AI can make mistakes. Verify important information against your source texts.
                  </span>
                </div>
              </div>

            </div>
          )}

          {/* VIEW: Knowledge Graph (SVG Canvas Node explorer) */}
          {activeView === 'graph' && (
            <div className="graph-view-grid">
              
              {/* Left Column: Interactive Graph Map */}
              <div className="graph-canvas-panel">
                <div className="graph-canvas-header">
                  <div className="graph-canvas-header-info">
                    <h3>Knowledge Graph</h3>
                    <p>Machine Learning - Lecture 01</p>
                  </div>
                  
                  <div className="graph-actions-row">
                    <button className="btn-utility" onClick={() => alert('Feature planned for later stage')}>share Share Graph</button>
                    <button className="btn-utility primary" onClick={() => alert('Quiz Generator planned for later stage')}>magic_button Generate Quiz</button>
                  </div>
                </div>

                {/* SVG Visual Network */}
                <div className="graph-svg-container">
                  <svg className="graph-svg" viewBox="0 0 600 400">
                    {/* Definitions of markers and filters */}
                    <defs>
                      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>

                    {/* Connected Lines (Links) */}
                    {/* ML (300, 80) -> SL (300, 200) */}
                    <line x1="300" y1="80" x2="300" y2="200" className={`link-line ${selectedNodeName === 'Machine Learning' || selectedNodeName === 'Supervised Learning' ? 'active' : ''}`} />
                    
                    {/* ML (300, 80) -> NN (450, 140) */}
                    <line x1="300" y1="80" x2="450" y2="140" className={`link-line ${selectedNodeName === 'Machine Learning' || selectedNodeName === 'Neural Networks' ? 'active' : ''}`} />

                    {/* SL (300, 200) -> Classification (160, 290) */}
                    <line x1="300" y1="200" x2="160" y2="290" className={`link-line ${selectedNodeName === 'Supervised Learning' || selectedNodeName === 'Classification' ? 'active' : ''}`} />

                    {/* SL (300, 200) -> Regression (300, 290) */}
                    <line x1="300" y1="200" x2="300" y2="290" className={`link-line ${selectedNodeName === 'Supervised Learning' || selectedNodeName === 'Regression' ? 'active' : ''}`} />

                    {/* SL (300, 200) -> Decision Trees (440, 290) */}
                    <line x1="300" y1="200" x2="440" y2="290" className={`link-line ${selectedNodeName === 'Supervised Learning' || selectedNodeName === 'Decision Trees' ? 'active' : ''}`} />

                    {/* Nodes (Circles & Labels) */}

                    {/* Node 1: Machine Learning (Parent Root) */}
                    <g onClick={() => setSelectedNodeName('Machine Learning')} style={{ cursor: 'pointer' }}>
                      <circle cx="300" cy="80" r="28" fill={selectedNodeName === 'Machine Learning' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="3" className="node-circle" filter={selectedNodeName === 'Machine Learning' ? 'url(#glow)' : ''} />
                      <text x="300" y="84" textAnchor="middle" fill={selectedNodeName === 'Machine Learning' ? '#ffffff' : 'var(--text-primary)'} className="node-text">ML</text>
                      <text x="300" y="45" textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px', fontWeight: 600 }}>Machine Learning</text>
                    </g>

                    {/* Node 2: Neural Networks */}
                    <g onClick={() => setSelectedNodeName('Neural Networks')} style={{ cursor: 'pointer' }}>
                      <circle cx="450" cy="140" r="24" fill={selectedNodeName === 'Neural Networks' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="2.5" className="node-circle" filter={selectedNodeName === 'Neural Networks' ? 'url(#glow)' : ''} />
                      <text x="450" y="144" textAnchor="middle" fill={selectedNodeName === 'Neural Networks' ? '#ffffff' : 'var(--text-primary)'} className="node-text">NN</text>
                      <text x="450" y="180" textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px', fontWeight: 600 }}>Neural Networks</text>
                    </g>

                    {/* Node 3: Supervised Learning (Selected focus) */}
                    <g onClick={() => setSelectedNodeName('Supervised Learning')} style={{ cursor: 'pointer' }}>
                      {/* Halo layer */}
                      <circle cx="300" cy="200" r="32" fill="var(--primary-glow)" stroke="rgba(37, 99, 235, 0.4)" strokeWidth="1" />
                      <circle cx="300" cy="200" r="24" fill={selectedNodeName === 'Supervised Learning' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="3" className="node-circle" filter={selectedNodeName === 'Supervised Learning' ? 'url(#glow)' : ''} />
                      <text x="300" y="204" textAnchor="middle" fill={selectedNodeName === 'Supervised Learning' ? '#ffffff' : 'var(--text-primary)'} className="node-text">SL</text>
                      {/* Concept Label Pill */}
                      <rect x="230" y="240" width="140" height="24" rx="12" fill="#ffffff" stroke="var(--primary)" strokeWidth="1.5" />
                      <text x="300" y="256" textAnchor="middle" fill="var(--primary)" style={{ fontSize: '10px', fontWeight: 800 }}>Supervised Learning</text>
                    </g>

                    {/* Node 4: Classification */}
                    <g onClick={() => setSelectedNodeName('Classification')} style={{ cursor: 'pointer' }}>
                      <circle cx="160" cy="290" r="22" fill={selectedNodeName === 'Classification' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="2" className="node-circle" filter={selectedNodeName === 'Classification' ? 'url(#glow)' : ''} />
                      <text x="160" y="294" textAnchor="middle" fill={selectedNodeName === 'Classification' ? '#ffffff' : 'var(--text-primary)'} className="node-text">CL</text>
                      <text x="160" y="328" textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px', fontWeight: 600 }}>Classification</text>
                    </g>

                    {/* Node 5: Regression */}
                    <g onClick={() => setSelectedNodeName('Regression')} style={{ cursor: 'pointer' }}>
                      <circle cx="300" cy="290" r="22" fill={selectedNodeName === 'Regression' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="2" className="node-circle" filter={selectedNodeName === 'Regression' ? 'url(#glow)' : ''} />
                      <text x="300" y="294" textAnchor="middle" fill={selectedNodeName === 'Regression' ? '#ffffff' : 'var(--text-primary)'} className="node-text">RG</text>
                      <text x="300" y="328" textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px', fontWeight: 600 }}>Regression</text>
                    </g>

                    {/* Node 6: Decision Trees */}
                    <g onClick={() => setSelectedNodeName('Decision Trees')} style={{ cursor: 'pointer' }}>
                      <circle cx="440" cy="290" r="22" fill={selectedNodeName === 'Decision Trees' ? 'var(--primary)' : '#ffffff'} stroke="var(--primary)" strokeWidth="2" className="node-circle" filter={selectedNodeName === 'Decision Trees' ? 'url(#glow)' : ''} />
                      <text x="440" y="294" textAnchor="middle" fill={selectedNodeName === 'Decision Trees' ? '#ffffff' : 'var(--text-primary)'} className="node-text">DT</text>
                      <text x="440" y="328" textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px', fontWeight: 600 }}>Decision Trees</text>
                    </g>
                  </svg>

                  {/* Floating Controller panel bottom left */}
                  <div className="graph-controls">
                    <button className="graph-control-btn" onClick={() => alert('Zoom in')} title="Zoom In">add</button>
                    <button className="graph-control-btn" onClick={() => alert('Zoom out')} title="Zoom Out">remove</button>
                    <button className="graph-control-btn" onClick={() => setSelectedNodeName('Supervised Learning')} title="Reset Center">refresh</button>
                    <button className="graph-control-btn" title="Pan Graph">pan_tool</button>
                  </div>
                </div>
              </div>

              {/* Right Column: Node details & insights inspector */}
              <div className="graph-inspector-panel">
                <div className="graph-inspector-header">
                  <h4>{selectedNode.badge}</h4>
                  <h3>{selectedNode.name}</h3>
                </div>

                <div className="graph-inspector-content">
                  {/* Definition section */}
                  <div className="inspector-section">
                    <h4>Definition</h4>
                    <p>{selectedNode.definition}</p>
                  </div>

                  {/* Related concepts list */}
                  <div className="inspector-section">
                    <h4>Related Concepts</h4>
                    <div className="related-list">
                      {selectedNode.related.map(concept => (
                        <span 
                          key={concept} 
                          className="related-pill"
                          onClick={() => {
                            if (nodesData[concept]) setSelectedNodeName(concept);
                          }}
                        >
                          {concept}
                          <ChevronRight size={10} />
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* AI Insights and study alerts */}
                  <div className="ai-insights-card">
                    <div className="ai-insights-title">
                      <Sparkles size={14} />
                      <span>AI Insights</span>
                    </div>
                    <p>{selectedNode.insights}</p>
                    
                    {/* Action link triggers Chat View */}
                    {systemStatus.hasDocument ? (
                      <button 
                        onClick={() => handleConceptChatTrigger(selectedNode.name)} 
                        className="ai-insights-link"
                        style={{ border: 'none', background: 'transparent', textAlign: 'left' }}
                      >
                        Chat about this <ChevronRight size={12} />
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                        <Info size={10} style={{ display: 'inline', marginRight: '0.2rem' }} />
                        Upload a file to ask queries.
                      </span>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* VIEW: Settings */}
          {activeView === 'settings' && (
            <div className="settings-view-container">
              <div className="view-header-section">
                <h2>Portal Settings</h2>
                <p>Manage your account preferences, configurations, and active API credentials.</p>
              </div>

              <div className="settings-grid">
                
                {/* Profile Card */}
                <div className="settings-card">
                  <div className="settings-card-header">
                    <User size={18} className="settings-card-icon" />
                    <h3>User Profile</h3>
                  </div>
                  <div className="settings-form-row">
                    <div>
                      <span className="settings-info-label">Full Name</span>
                      <p className="settings-info-value">{user ? user.name : 'Chavidi'}</p>
                    </div>
                    <div>
                      <span className="settings-info-label">Email Address</span>
                      <p className="settings-info-value">{user ? user.email : 'chavidi5635@gmail.com'}</p>
                    </div>
                  </div>
                  <div className="settings-form-row" style={{ marginTop: '0.5rem' }}>
                    <div>
                      <span className="settings-info-label">Workspace Status</span>
                      <p className="settings-info-value" style={{ color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--accent-emerald)', borderRadius: '50%' }}></span>
                        Active
                      </p>
                    </div>
                    <div>
                      <span className="settings-info-label">Access Level</span>
                      <p className="settings-info-value">{userPlan}</p>
                    </div>
                  </div>
                </div>

                {/* Subscription Plans Card */}
                <div className="settings-card">
                  <div className="settings-card-header">
                    <Layers size={18} className="settings-card-icon" style={{ color: 'var(--primary)' }} />
                    <h3>Subscription Plans & Billing</h3>
                  </div>

                  <div className="pricing-plans-grid">
                    {/* Free Plan */}
                    <div className={`price-card ${userPlan === 'Free Tier' ? 'premium' : ''}`} style={userPlan === 'Free Tier' ? { borderColor: 'var(--primary)' } : {}}>
                      {userPlan === 'Free Tier' && <span className="price-badge-popular" style={{ backgroundColor: 'var(--text-muted)' }}>Current</span>}
                      <div className="price-card-header-info">
                        <h4>Free Tier</h4>
                        <div className="price-card-price">$0 <span>/ month</span></div>
                      </div>
                      <ul className="price-card-features-list">
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> 1 active lecture document limit</li>
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> Standard response speed</li>
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> 15 AI Q&A queries per day</li>
                      </ul>
                      <button 
                        onClick={() => {
                          if (userPlan !== 'Free Tier') {
                            setUserPlan('Free Tier');
                            alert('Downgraded to Free Tier.');
                          }
                        }} 
                        className="btn-secondary" 
                        disabled={userPlan === 'Free Tier'}
                        style={{ marginTop: 'auto' }}
                      >
                        {userPlan === 'Free Tier' ? 'Active Plan' : 'Downgrade to Free'}
                      </button>
                    </div>

                    {/* Premium Plan */}
                    <div className={`price-card ${userPlan !== 'Free Tier' ? 'premium' : ''}`}>
                      {userPlan !== 'Free Tier' && !userPlan.includes('Promo') && <span className="price-badge-popular">Active</span>}
                      {userPlan.includes('Promo') && <span className="price-badge-popular" style={{ backgroundColor: 'var(--accent-amber)' }}>Promo</span>}
                      <div className="price-card-header-info">
                        <h4>Premium Plan</h4>
                        <div className="price-card-price">$9.99 <span>/ month</span></div>
                      </div>
                      <ul className="price-card-features-list">
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> Unlimited lecture files</li>
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> Priority GPU response speed</li>
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> Unlimited RAG queries</li>
                        <li><CheckCircle2 size={12} className="feature-check-icon" /> Interactive SVG Concept Graphs</li>
                      </ul>
                      <button 
                        onClick={() => {
                          if (userPlan === 'Free Tier') {
                            setBillingForm({ number: '', name: '', expiry: '', cvv: '' });
                            setBillingError(null);
                            setShowBillingModal(true);
                          }
                        }} 
                        className="action-btn-primary" 
                        disabled={userPlan !== 'Free Tier' && !userPlan.includes('Promo')}
                        style={{ marginTop: 'auto' }}
                      >
                        {userPlan !== 'Free Tier' ? 'Active Plan' : 'Upgrade to Premium'}
                      </button>
                    </div>
                  </div>

                  {/* Student Promo Banner */}
                  <div className="student-promo-banner">
                    <div className="student-promo-content">
                      <Sparkles size={20} className="student-promo-icon" style={{ color: 'var(--accent-amber)' }} />
                      <div className="student-promo-text">
                        <h4>🎓 Student Promotion Active</h4>
                        <p>University students get a free premium plan offer for 3 months! Verify your account to claim your premium trial.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        if (userPlan.includes('Promo')) {
                          alert('You have already claimed this student offer!');
                          return;
                        }
                        const email = user ? user.email : '';
                        if (email.endsWith('.edu') || email.includes('gmail.com') || window.confirm('Verify student email to continue?')) {
                          setUserPlan('University Premium (Promo: 3 Months Free)');
                          
                          setNotifications(prev => [
                            { id: Date.now(), text: '🎓 Student offer claimed successfully! You unlocked 3 months of Premium.', time: 'Just now' },
                            ...prev
                          ]);
                          setUnreadNotifications(true);
                          
                          alert('Verification Successful! You unlocked 3 months of free Premium Plan.');
                        }
                      }}
                      className="action-btn-primary"
                      style={{ 
                        width: 'auto', 
                        padding: '0.55rem 1.15rem', 
                        fontSize: '0.8rem', 
                        backgroundColor: '#b45309', 
                        borderColor: '#b45309', 
                        boxShadow: 'none' 
                      }}
                    >
                      {userPlan.includes('Promo') ? 'Promo Claimed' : 'Claim 3 Months Free'}
                    </button>
                  </div>
                </div>

                {/* API Credentials Configuration */}
                <div className="settings-card">
                  <div className="settings-card-header">
                    <Cpu size={18} className="settings-card-icon" />
                    <h3>LLM Provider Credentials</h3>
                  </div>
                  <div className="form-group">
                    <label>Google Gemini API Key</label>
                    <input 
                      type="password" 
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      placeholder={systemStatus.apiKeyConfigured ? '••••••••••••••••••••••••••••••••••••••••' : 'Enter API Key to override default'}
                      className="text-input"
                    />
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {systemStatus.apiKeyConfigured 
                        ? 'Connected. Using API Key configured in server environment (.env).' 
                        : 'No API key configured in server environment. Enter an API key here.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button 
                      onClick={async () => {
                        if (!customApiKey.trim()) {
                          alert('Please enter an API Key to save.');
                          return;
                        }
                        try {
                          alert('API Key updated successfully in local session workspace.');
                        } catch (err) {
                          alert('Failed to update API key.');
                        }
                      }}
                      className="action-btn-primary" 
                      style={{ width: 'auto', padding: '0.55rem 1.25rem', fontSize: '0.82rem' }}
                    >
                      Save API Credentials
                    </button>
                  </div>
                </div>

                {/* Interface preferences */}
                <div className="settings-card">
                  <div className="settings-card-header">
                    <Settings size={18} className="settings-card-icon" />
                    <h3>Portal Preferences</h3>
                  </div>
                  
                  <div className="settings-toggle-row">
                    <div className="toggle-switch-label">
                      <h4>Automatic Concept Extraction</h4>
                      <p>Generate knowledge graph entities immediately on document uploads.</p>
                    </div>
                    <label className="switch-container">
                      <input 
                        type="checkbox" 
                        checked={conceptsEnabled} 
                        onChange={() => setConceptsEnabled(!conceptsEnabled)}
                        className="switch-input"
                      />
                      <span className="switch-slider"></span>
                    </label>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '0.5rem 0' }} />

                  <div className="settings-toggle-row">
                    <div className="toggle-switch-label">
                      <h4>Portal System Notifications</h4>
                      <p>Send in-app notifications when background model tasks finish processing.</p>
                    </div>
                    <label className="switch-container">
                      <input 
                        type="checkbox" 
                        checked={notifyEnabled} 
                        onChange={() => {
                          setNotifyEnabled(!notifyEnabled);
                          if (notifyEnabled) {
                            setNotifications([]);
                            setUnreadNotifications(false);
                          } else {
                            setNotifications([
                              { id: 1, text: 'System notifications reactivated.', time: 'Just now' }
                            ]);
                            setUnreadNotifications(true);
                          }
                        }}
                        className="switch-input"
                      />
                      <span className="switch-slider"></span>
                    </label>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>

      {/* 3. Billing Payment Modal Overlay */}
      {showBillingModal && (
        <div className="modal-overlay" onClick={() => { setShowBillingModal(false); setBillingError(null); }}>
          <div className="billing-modal-card" onClick={(e) => e.stopPropagation()}>
            
            <div className="modal-header-row">
              <h3>Upgrade to Premium</h3>
              <button 
                onClick={() => { setShowBillingModal(false); setBillingError(null); }}
                className="header-icon-btn"
                style={{ fontSize: '1.25rem', border: 'none', background: 'none', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '-0.5rem' }}>
              Confirm your upgrade for **$9.99/month**. You will be billed secure recursive credits.
            </p>

            {/* Live Credit Card Mockup */}
            <div className="credit-card-mockup">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="mockup-chip"></div>
                <BookOpen size={20} style={{ opacity: 0.8 }} />
              </div>
              
              <div className="mockup-number">
                {billingForm.number || '•••• •••• •••• ••••'}
              </div>

              <div className="mockup-footer">
                <div className="price-card-header-info">
                  <div className="mockup-label">Card Holder</div>
                  <div className="mockup-val">{billingForm.name || 'Your Name'}</div>
                </div>
                <div className="price-card-header-info" style={{ alignItems: 'flex-end' }}>
                  <div className="mockup-label">Expires</div>
                  <div className="mockup-val">{billingForm.expiry || 'MM/YY'}</div>
                </div>
              </div>
            </div>

            {/* Error Alert Box */}
            {billingError && (
              <div style={{
                background: 'var(--accent-rose-light)',
                border: '1px solid var(--accent-rose)',
                borderRadius: '10px',
                padding: '0.65rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--accent-rose)',
                fontSize: '0.8rem',
                animation: 'fadeIn 0.2s ease-out'
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{billingError}</span>
              </div>
            )}

            {/* Input Billing Fields */}
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                setBillingError(null);

                if (!billingForm.name || !billingForm.number || !billingForm.expiry || !billingForm.cvv) {
                  setBillingError('Please fill in all credit card details.');
                  return;
                }

                // Real-world Card Validation: Luhn (Mod 10) Checksum Algorithm
                const digits = billingForm.number.replace(/\s+/g, '');
                if (!/^\d{13,19}$/.test(digits)) {
                  setBillingError('Invalid card format. Card number must be between 13 and 19 digits.');
                  return;
                }

                let sum = 0;
                let shouldDouble = false;
                for (let i = digits.length - 1; i >= 0; i--) {
                  let digit = parseInt(digits.charAt(i), 10);
                  if (shouldDouble) {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                  }
                  sum += digit;
                  shouldDouble = !shouldDouble;
                }

                if ((sum % 10) !== 0) {
                  setBillingError('Invalid credit card number (Luhn checksum failed). Please use a valid card.');
                  return;
                }
                
                setBillingLoading(true);
                // Simulate secure transaction checkout delay
                setTimeout(() => {
                  setBillingLoading(false);
                  setUserPlan('Premium Plan');
                  setShowBillingModal(false);
                  
                  // Prepend success notification
                  setNotifications(prev => [
                    { id: Date.now(), text: '💳 Premium subscription activated successfully.', time: 'Just now' },
                    ...prev
                  ]);
                  setUnreadNotifications(true);
                  
                  alert('Payment Successful! Thank you for subscribing to OmniStudy Premium.');
                }, 1800);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div className="form-group">
                <label>Cardholder Name</label>
                <input 
                  type="text" 
                  required
                  value={billingForm.name}
                  onChange={(e) => setBillingForm({ ...billingForm, name: e.target.value })}
                  placeholder="John Doe"
                  className="text-input"
                  disabled={billingLoading}
                />
              </div>

              <div className="form-group">
                <label>Card Number</label>
                <input 
                  type="text" 
                  required
                  maxLength="19"
                  value={billingForm.number}
                  onChange={(e) => {
                    let val = e.target.value.replace(/\s?/g, '').replace(/(\d{4})/g, '$1 ').trim();
                    setBillingForm({ ...billingForm, number: val });
                  }}
                  placeholder="4111 2222 3333 4444"
                  className="text-input"
                  disabled={billingLoading}
                />
              </div>

              <div className="billing-form-grid">
                <div className="form-group">
                  <label>Expiry Date</label>
                  <input 
                    type="text" 
                    required
                    maxLength="5"
                    value={billingForm.expiry}
                    onChange={(e) => {
                      let val = e.target.value;
                      if (val.length === 2 && !val.includes('/')) val += '/';
                      setBillingForm({ ...billingForm, expiry: val });
                    }}
                    placeholder="MM/YY"
                    className="text-input"
                    disabled={billingLoading}
                  />
                </div>
                <div className="form-group">
                  <label>CVV</label>
                  <input 
                    type="password" 
                    required
                    maxLength="3"
                    value={billingForm.cvv}
                    onChange={(e) => setBillingForm({ ...billingForm, cvv: e.target.value })}
                    placeholder="123"
                    className="text-input"
                    disabled={billingLoading}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                <button 
                  type="button" 
                  onClick={() => setShowBillingModal(false)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                  disabled={billingLoading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="action-btn-primary"
                  style={{ flex: 1 }}
                  disabled={billingLoading}
                >
                  {billingLoading ? 'Processing...' : 'Pay & Upgrade'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;
