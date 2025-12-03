import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

// Base URL for API
const API_URL = 'http://localhost:5000/api';

function App() {
  // View State: 'home' | 'chat' | 'details'
  const [view, setView] = useState('home');
  const [bookingsList, setBookingsList] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);

  // Chat State
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({});
  const [status, setStatus] = useState('idle'); 
  const chatEndRef = useRef(null);

  // --- 1. Fetch Bookings (Home View) ---
  const fetchBookings = async () => {
    try {
      const res = await axios.get(`${API_URL}/bookings`);
      setBookingsList(res.data);
    } catch (err) {
      console.error("Error fetching bookings:", err);
    }
  };

  useEffect(() => {
    if (view === 'home') {
      fetchBookings();
    }
  }, [view]);

  // --- 2. Delete Booking ---
  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to cancel this booking?")) return;
    try {
      await axios.delete(`${API_URL}/bookings/${id}`);
      fetchBookings(); // Refresh list
    } catch (err) {
      alert("Error deleting booking");
    }
  };

  // --- 3. View Details ---
  const handleViewDetails = (booking) => {
    setSelectedBooking(booking);
    setView('details');
  };

  // --- 4. Start New Chat Session ---
  const startNewBooking = () => {
    setMessages([
      { sender: 'bot', text: "Hello! I am the Vaiu Bistro Assistant. I can help you book a table. What date and time would you like?" }
    ]);
    setBookingDetails({});
    setStatus('idle');
    setView('chat');
  };

  // --- 5. Chat & Auto-Confirm Logic ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    window.speechSynthesis.speak(utterance);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser does not support voice. Try Chrome.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('listening');
    };
    recognition.onend = () => {
      setIsListening(false);
      if (status === 'listening') setStatus('idle');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      handleSendMessage(transcript);
    };
    recognition.start();
  };

  const handleSendMessage = async (userText) => {
    if (!userText.trim()) return;

    const newMessages = [...messages, { sender: 'user', text: userText }];
    setMessages(newMessages);
    setStatus('processing');

    try {
      const response = await axios.post(`${API_URL}/chat`, {
        message: userText,
        history: newMessages 
      });

      const aiData = response.data;
      setBookingDetails(aiData.bookingDetails || {});
      setMessages(prev => [...prev, { sender: 'bot', text: aiData.reply }]);
      speak(aiData.reply);

      // AUTOMATIC CONFIRMATION TRIGGER
      if (aiData.intent === 'confirmed') {
        await handleAutoSave(aiData.bookingDetails);
      }

    } catch (error) {
      console.error("Chat error:", error);
      setStatus('idle');
    }
  };

  const handleAutoSave = async (details) => {
    try {
        const payload = {
            customerName: details.name || "Guest",
            numberOfGuests: details.guests || 2,
            bookingDate: details.date || new Date(),
            bookingTime: details.time || "19:00",
            cuisinePreference: details.cuisine || "Any",
            specialRequests: details.specialRequests || "None",
            seatingPreference: details.seating || "Any",
            status: "Confirmed"
        };
        
        await axios.post(`${API_URL}/bookings`, payload);
        
        const successMsg = "I have successfully saved your booking! Redirecting to home...";
        setMessages(prev => [...prev, { sender: 'bot', text: successMsg }]);
        speak(successMsg);
        
        setTimeout(() => {
            setView('home');
        }, 4000); // Redirect after 4 seconds
        
    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, { sender: 'bot', text: "There was an error saving the booking." }]);
    }
  };

  // --- RENDERERS ---

  const renderHome = () => (
    <div className="home-container">
      <div className="home-header">
        <h2>Your Bookings</h2>
        <button className="primary-btn" onClick={startNewBooking}>+ New Booking</button>
      </div>
      <div className="bookings-grid">
        {bookingsList.length === 0 ? (
          <p className="empty-state">No bookings found.</p>
        ) : (
          bookingsList.map((b) => (
            <div key={b._id} className="booking-card-item" onClick={() => handleViewDetails(b)}>
              <div className="card-header">
                <span className="date-badge">{new Date(b.bookingDate).toLocaleDateString()}</span>
                <span className={`status-badge ${b.status.toLowerCase()}`}>{b.status}</span>
              </div>
              <h3>{b.customerName}</h3>
              <p>{b.bookingTime} • {b.numberOfGuests} Guests</p>
              <div className="card-actions">
                <button className="delete-btn" onClick={(e) => handleDelete(b._id, e)}>🗑️ Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderDetails = () => (
    <div className="details-container">
      <button className="back-btn" onClick={() => setView('home')}>← Back to Bookings</button>
      <h2>Booking Details</h2>
      <div className="details-card">
        <div className="detail-row"><strong>ID:</strong> {selectedBooking._id}</div>
        <div className="detail-row"><strong>Name:</strong> {selectedBooking.customerName}</div>
        <div className="detail-row"><strong>Date:</strong> {new Date(selectedBooking.bookingDate).toDateString()}</div>
        <div className="detail-row"><strong>Time:</strong> {selectedBooking.bookingTime}</div>
        <div className="detail-row"><strong>Guests:</strong> {selectedBooking.numberOfGuests}</div>
        <div className="detail-row"><strong>Cuisine:</strong> {selectedBooking.cuisinePreference}</div>
        <div className="detail-row"><strong>Seating:</strong> {selectedBooking.seatingPreference}</div>
        <div className="detail-row"><strong>Notes:</strong> {selectedBooking.specialRequests}</div>
        <div className="detail-row"><strong>Status:</strong> {selectedBooking.status}</div>
      </div>
    </div>
  );

  const renderChat = () => (
    <div className="chat-layout">
        <div className="chat-header-bar">
            <button className="back-btn" onClick={() => setView('home')}>Exit</button>
            <h3>New Booking Assistant</h3>
        </div>
        <div className="chat-workspace">
            {/* Live Form Preview */}
            <div className="live-preview">
                <h4>Live Details</h4>
                <div className="preview-item">Name: {bookingDetails.name || '...'}</div>
                <div className="preview-item">Date: {bookingDetails.date || '...'}</div>
                <div className="preview-item">Time: {bookingDetails.time || '...'}</div>
                <div className="preview-item">Guests: {bookingDetails.guests || '...'}</div>
            </div>
            
            {/* Chat Area */}
            <div className="chat-box">
                <div className="messages-area">
                    {messages.map((msg, idx) => (
                    <div key={idx} className={`message-bubble ${msg.sender}`}>
                        {msg.text}
                    </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                <div className="input-area">
                    <button 
                        className={`mic-btn ${isListening ? 'listening' : ''}`}
                        onClick={startListening}
                        disabled={status === 'processing' || status === 'speaking'}
                    >
                        {isListening ? '🛑 Listening...' : '🎙️ Tap to Speak'}
                    </button>
                    <div className="status-label">{status}</div>
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="app-root">
      <header className="main-header">
        <h1>🍽️ Vaiu Bistro</h1>
      </header>
      <main className="main-content">
        {view === 'home' && renderHome()}
        {view === 'chat' && renderChat()}
        {view === 'details' && selectedBooking && renderDetails()}
      </main>
    </div>
  );
}

export default App;