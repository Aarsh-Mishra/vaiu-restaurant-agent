import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

// Base URL for our Express Backend
const API_URL = 'http://localhost:5000/api';

function App() {
  // --- STATE MANAGEMENT ---
  
  // View State: Controls which "Screen" is visible ('home' | 'chat' | 'details')
  const [view, setView] = useState('home');
  
  // Data State: Holds list of bookings and the currently selected one
  const [bookingsList, setBookingsList] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  
  // Location State: Holds user's Lat/Lon for weather API
  const [userLocation, setUserLocation] = useState(null); 

  // Chat State: Messages array, listening status, and extracted details
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({});
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'processing' | 'speaking'
  
  // Ref to auto-scroll chat to bottom
  const chatEndRef = useRef(null);

  // --- 1. Geolocation Setup (On Mount) ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Save coordinates to state to send with chat messages later
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        },
        (error) => {
          console.log("Location access denied or unavailable. Using server default.");
        }
      );
    }
  }, []);

  // --- 2. Dashboard Logic (Fetching Data) ---
  const fetchBookings = async () => {
    try {
      const res = await axios.get(`${API_URL}/bookings`);
      setBookingsList(res.data);
    } catch (err) {
      console.error("Error fetching bookings:", err);
    }
  };

  // Refresh bookings whenever we return to the 'home' view
  useEffect(() => {
    if (view === 'home') {
      fetchBookings();
    }
  }, [view]);

  // Handle Deleting a booking
  const handleDelete = async (id, e) => {
    e.stopPropagation(); // Prevent clicking the card behind the button
    if (!window.confirm("Are you sure you want to cancel this booking?")) return;
    try {
      await axios.delete(`${API_URL}/bookings/${id}`);
      fetchBookings(); // Refresh the list after deletion
    } catch (err) {
      alert("Error deleting booking");
    }
  };

  // Switch to Details View
  const handleViewDetails = (booking) => {
    setSelectedBooking(booking);
    setView('details');
  };

  // --- 3. Chat Session Initialization ---
  const startNewBooking = () => {
    // Reset conversation state
    setMessages([
      { sender: 'bot', text: "Hello! I am the Vaiu Bistro Assistant. I can help you book a table. What date and time would you like?" }
    ]);
    setBookingDetails({});
    setStatus('idle');
    setView('chat'); // Switch to Chat UI
  };

  // Auto-scroll logic for chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- 4. Text-to-Speech (TTS) ---
  const speak = (text) => {
    if (!window.speechSynthesis) return;
    
    window.speechSynthesis.cancel(); // Stop any current speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    
    window.speechSynthesis.speak(utterance);
  };

  // --- 5. Speech-to-Text (STT) ---
  const startListening = () => {
    // Check for browser support (Chrome/Edge/Safari)
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
      // Only reset status if we aren't already processing logic
      if (status === 'listening') setStatus('idle');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      handleSendMessage(transcript);
    };
    
    recognition.start();
  };

  // --- 6. Core Chat Logic ---
  const handleSendMessage = async (userText) => {
    if (!userText.trim()) return;

    // 1. Add User Message immediately
    const newMessages = [...messages, { sender: 'user', text: userText }];
    setMessages(newMessages);
    setStatus('processing');

    try {
      // 2. Send to Backend with Location and History
      const response = await axios.post(`${API_URL}/chat`, {
        message: userText,
        history: newMessages,
        userLocation: userLocation // Passing location for dynamic weather
      });

      const aiData = response.data;
      
      // 3. Update UI with extraction results
      setBookingDetails(aiData.bookingDetails || {});
      setMessages(prev => [...prev, { sender: 'bot', text: aiData.reply }]);
      speak(aiData.reply);

      // 4. CHECK FOR AUTO-CONFIRMATION
      // If the AI sets intent to 'confirmed', we save without asking user to click a button
      if (aiData.intent === 'confirmed') {
        await handleAutoSave(aiData.bookingDetails);
      }

    } catch (error) {
      console.error("Chat error:", error);
      setStatus('idle');
    }
  };

  // --- 7. Auto-Save Logic ---
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
        
        // POST to create booking
        await axios.post(`${API_URL}/bookings`, payload);
        
        const successMsg = "I have successfully saved your booking! Redirecting to home...";
        setMessages(prev => [...prev, { sender: 'bot', text: successMsg }]);
        speak(successMsg);
        
        // Redirect to Home Dashboard after 4 seconds
        setTimeout(() => {
            setView('home');
        }, 4000); 
        
    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, { sender: 'bot', text: "There was an error saving the booking." }]);
    }
  };

  // --- 8. UI RENDERERS ---

  // Home View: List of Bookings
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

  // Details View: Single Booking Info
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

  // Chat View: Voice Agent Interface
  const renderChat = () => (
    <div className="chat-layout">
        <div className="chat-header-bar">
            <button className="back-btn" onClick={() => setView('home')}>Exit</button>
            <h3>New Booking Assistant</h3>
        </div>
        <div className="chat-workspace">
            {/* Live Data Preview Side Panel */}
            <div className="live-preview">
                <h4>Live Details</h4>
                <div className="preview-item">Name: {bookingDetails.name || '...'}</div>
                <div className="preview-item">Date: {bookingDetails.date || '...'}</div>
                <div className="preview-item">Time: {bookingDetails.time || '...'}</div>
                <div className="preview-item">Guests: {bookingDetails.guests || '...'}</div>
            </div>
            
            {/* Main Chat Area */}
            <div className="chat-box">
                <div className="messages-area">
                    {messages.map((msg, idx) => (
                    <div key={idx} className={`message-bubble ${msg.sender}`}>
                        {msg.text}
                    </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                {/* Input Controls */}
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
        {/* Conditional Rendering based on 'view' state */}
        {view === 'home' && renderHome()}
        {view === 'chat' && renderChat()}
        {view === 'details' && selectedBooking && renderDetails()}
      </main>
    </div>
  );
}

export default App;