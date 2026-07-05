"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { 
  Send, 
  Trash2, 
  Menu, 
  X, 
  MessageSquare, 
  Sparkles, 
  AlertTriangle, 
  ChevronRight, 
  CornerDownLeft 
} from "lucide-react";
import DOMPurify from "dompurify";
import { ChatService, EmergencyService } from "../../services/api";
import { useLanguage } from "@/context/LanguageContext";
import LanguageSelector from "@/components/chat/LanguageSelector";
import LanguageBadge from "@/components/chat/LanguageBadge";
import { io } from "socket.io-client";

// Modular Redesign Components
import RakkuFloatingAssistant from "../../components/chat/RakkuFloatingAssistant";
import RakkuWelcomeCard from "../../components/chat/RakkuWelcomeCard";
import ChatMessage from "../../components/chat/ChatMessage";
import { avatarImages } from "../../utils/avatarConfig";
import Announcements from "../../lib/accessibility/announcements";
import SOSDialog from "../../components/SOSDialog";

const getBackendUrl = () => {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_BACKEND_URL || "https://rakku-chatbot-v1.onrender.com/api";
  }
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return isLocalhost 
    ? "http://localhost:3001/api" 
    : "https://rakku-chatbot-v1.onrender.com/api";
};

const BACKEND_URL = getBackendUrl();

interface Message {
  role: "user" | "assistant";
  text: string;
  isStreaming?: boolean;
  avatarState?: string;
}

interface ChatSession {
  id: string;
  title: string;
  date: string;
}

// Inner Component that uses search params
function ChatContent() {
  const searchParams = useSearchParams();
  const triggerQuery = searchParams.get("trigger");

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [initialReferenceNumber, setInitialReferenceNumber] = useState<string | null>(null);
  const [isEmergencyDialogOpen, setIsEmergencyDialogOpen] = useState(false);
  const [waitingForManualLocation, setWaitingForManualLocation] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [history, setHistory] = useState<ChatSession[]>([
    { id: "sess-1", title: "Phone Stolen Complaint", date: "Today" },
    { id: "sess-2", title: "Tenant Verification Details", date: "Yesterday" },
    { id: "sess-3", title: "Character Certificate Info", date: "3 days ago" },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // --- Inspector Rakku Panel States ---
  const [currentAvatarState, setCurrentAvatarState] = useState<string>("SALUTE");
  const [currentSpeechBubble, setCurrentSpeechBubble] = useState<string>(
    "🫡 Namaste!\nI am Inspector Rakku, your UP Police Virtual Assistant.\nHow may I assist you today?"
  );
  const [hasInitializedWelcome, setHasInitializedWelcome] = useState<boolean>(false);
  const [showWelcomeCard, setShowWelcomeCard] = useState<boolean>(false);
  const autoIdleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Thinking Experience rotating helper messages
  const thinkingMessages = [
    "Checking information...",
    "Reviewing your request...",
    "Preparing guidance...",
    "Processing details..."
  ];
  const [thinkingIndex, setThinkingIndex] = useState(0);

  const updateAvatarAndSpeech = (state: string, text: string) => {
    setCurrentAvatarState(state);
    setCurrentSpeechBubble(text);

    if (autoIdleTimerRef.current) {
      clearTimeout(autoIdleTimerRef.current);
      autoIdleTimerRef.current = null;
    }

    const autoIdleStates = ["TALKING", "SUCCESS", "COMPLETED", "GOODBYE"];
    if (autoIdleStates.includes(state)) {
      autoIdleTimerRef.current = setTimeout(() => {
        setCurrentAvatarState("IDLE");
      }, 5000);
    }
  };

  const { selectedLanguage, translate } = useLanguage();

  const getLocalizedWelcome = () => {
    if (!selectedLanguage) return "";
    const mainGreeting = translate("MAIN_MENU_GREETING");

    let complaintOpt = "🚔 File a Complaint";
    let verificationOpt = "🏠 Tenant Verification";
    let certificateOpt = "📜 Character Certificate";
    let permissionOpt = "🎭 Event Permission";
    let trackingOpt = "🔍 Track Application";
    let nearestStationOpt = "nearest police station";
    let emergencyOpt = "Emergency Contacts";

    if (selectedLanguage === "hi") {
      complaintOpt = "🚔 शिकायत दर्ज करें";
      verificationOpt = "🏠 किरायेदार सत्यापन";
      certificateOpt = "📜 चरित्र प्रमाण पत्र";
      permissionOpt = "🎭 कार्यक्रम अनुमति";
      trackingOpt = "🔍 आवेदन की स्थिति";
      nearestStationOpt = "📍 नजदीकी थाना खोजें";
      emergencyOpt = "🆘 आपातकालीन सहायता";
    }

    const complaint = `[🚔 ${translate("SERVICE_COMPLAINT")}](option:${complaintOpt})`;
    const verification = `[🏠 ${translate("SERVICE_VERIFICATION")}](option:${verificationOpt})`;
    const certificate = `[📜 ${translate("SERVICE_CERTIFICATE")}](option:${certificateOpt})`;
    const permission = `[🎭 ${translate("SERVICE_PERMISSION")}](option:${permissionOpt})`;
    const tracking = `[🔍 ${translate("SERVICE_TRACKING")}](option:${trackingOpt})`;
    const nearestStation = `[📍 ${translate("SERVICE_NEAREST_STATION")}](option:${nearestStationOpt})`;
    const emergency = `[🆘 ${translate("SERVICE_EMERGENCY")}](option:${emergencyOpt})`;

    return `${mainGreeting}\n\n${complaint}\n\n${verification}\n\n${certificate}\n\n${permission}\n\n${tracking}\n\n${nearestStation}\n\n${emergency}`;
  };

  // --- Police Station Helpers ---
  const trackTelemetry = async (type: string, value?: string) => {
    try {
      await fetch(`${BACKEND_URL}/citizen-assistance/analytics/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
    } catch (e) {
      console.warn('Telemetry send failed:', e);
    }
  };

  const formatStationMessage = (data: any, source: string): string => {
    const demoTag = data.demoMode ? '\n⚠️ *(Demo Mode — data may not be real)*' : '';
    
    let phoneLine = '';
    if (data.station?.phone && data.station.phone.toString().trim().toLowerCase() !== 'null' && data.station.phone.toString().trim() !== '') {
      phoneLine = `- **Phone Number:** [${data.station.phone}](tel:${data.station.phone})\n`;
    }

    let distanceLine = '';
    if (data.distanceKm) {
      const distStr = data.distanceKm.toString();
      const isNumeric = !isNaN(parseFloat(distStr)) && isFinite(Number(distStr));
      if (isNumeric && parseFloat(distStr) > 0) {
        distanceLine = `- **Distance:** **${distStr} km** away\n`;
      } else if (!isNumeric && !distStr.toLowerCase().includes('unknown') && !distStr.toLowerCase().includes('unavailable')) {
        distanceLine = `- **Distance:** ${distStr}\n`;
      }
    }

    let mapsLine = '';
    if (data.mapsUrl && data.mapsUrl.toString().trim() !== '') {
      mapsLine = `👉 [Open in Google Maps](${data.mapsUrl})`;
    }

    return (
      `🚔 **Nearest Police Station Found** *(${source})*:\n\n` +
      `- **Name:** **${data.station?.name}**\n` +
      `- **Address:** ${data.station?.address}\n` +
      phoneLine +
      distanceLine +
      (mapsLine ? `\n${mapsLine}` : '') +
      demoTag
    );
  };

  const searchByCity = async (cityText: string): Promise<void> => {
    setLoading(true);
    trackTelemetry('manual_search_used', cityText);
    updateAvatarAndSpeech("THINKING", `Searching for police stations in "${cityText}"...`);
    try {
      const res = await fetch(
        `${BACKEND_URL}/citizen-assistance/police-stations/nearest?city=${encodeURIComponent(cityText)}`
      );
      const data = await res.json();
      if (data.success && data.station) {
        if (data.demoMode) trackTelemetry('demo_mode_triggered');
        const text = formatStationMessage(data, 'Manual Search');
        setMessages((prev) => [...prev, { role: 'assistant', text: text }]);
        updateAvatarAndSpeech("SUCCESS", `I successfully located the nearest police station: ${data.station.name}.`);
      } else {
        const text = `😔 I couldn't find a police station matching **"${cityText}"**.\n\nPlease try a city name like:\n- Lucknow\n- Kanpur\n- Noida\n- Varanasi\n- Ghaziabad\n- Prayagraj\n\nOr type **cancel** to go back.`;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text,
          },
        ]);
        setWaitingForManualLocation(true); // keep waiting for another attempt
        updateAvatarAndSpeech("POINTING", `I could not locate any police station for "${cityText}". Please provide a different district, city, or locality.`);
      }
    } catch (e: any) {
      trackTelemetry('police_station_api_failure', e?.message || 'unknown');
      const text = '👮 I\'m sorry — the police station service is temporarily unavailable.\n\nPlease try again in a moment, or call **112** for emergencies.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text,
        },
      ]);
      updateAvatarAndSpeech("ERROR", "I am currently unable to process your request. Please try again shortly.");
    } finally {
      setLoading(false);
    }
  };

  // Initialize Session ID and Socket for Live Emergency Status Updates
  useEffect(() => {
    setSessionId(`session-${Math.random().toString(36).substring(7)}`);

    const socket = io(`${BACKEND_URL.replace('/api', '')}/emergency`, {
      transports: ["websocket"]
    });

    socket.on("alert_updated", (alert) => {
      // Look for updates if this is the active alert
      if (activeAlertId && alert.id === activeAlertId) {
        if (alert.status === "ACKNOWLEDGED") {
          setMessages(prev => [...prev, {
            role: "assistant",
            text: `✅ **Control Room Update:** Your emergency alert (${alert.referenceNumber}) has been acknowledged by the control desk. Our team is coordinating the response.`
          }]);
        } else if (alert.status === "RESOLVED") {
          setMessages(prev => [...prev, {
            role: "assistant",
            text: `✅ **Control Room Update:** Your emergency request (${alert.referenceNumber}) has been marked as resolved.`
          }]);
          setSosTriggered(false);
          setActiveAlertId(null);
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeAlertId]);

  const handleSOS = async () => {
    if (sosLoading) return;
    setSosLoading(true);
    
    // Immediately raise alert (fire and forget)
    EmergencyService.triggerSos(undefined, "SOS_BUTTON", { fullName: "Anonymous Citizen", mobileNumber: "Pending" })
      .then(async (res) => {
        setSosTriggered(true);
        setInitialReferenceNumber(res.referenceNumber);
        
        // Open the dialog immediately
        setIsEmergencyDialogOpen(true);

        if (res.isDuplicate) {
          // If it's a duplicate, we still open the dialog (which will show the active state)
          // but we can add a smaller chat message for history.
          setMessages(prev => [...prev, {
            role: "assistant",
            text: `⚠️ **Update:** Emergency alert ${res.referenceNumber} has been re-escalated.`
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: "assistant",
            text: `🚨 **Emergency Alert Sent Successfully**\n\nYour emergency alert has been received.\n\nReference Number: **${res.referenceNumber}**\n\nOur response team has been notified. If it is safe, keep your phone nearby and keep this page open.\n\n*(Please allow location access so we can pinpoint your coordinates)*`
          }]);
        }

        EmergencyService.getActiveAlerts().then(alerts => {
          const matched = alerts.find((a: any) => a.referenceNumber === res.referenceNumber);
          if (matched) setActiveAlertId(matched.id);
        });

      })
      .catch((err) => {
        console.error("Failed to trigger SOS", err);
      })
      .finally(() => {
        setSosLoading(false);
      });
  };

  // Handle responsive sidebar open/close based on viewport width
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    // Initialize based on current width
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Welcome experience check from sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined" && selectedLanguage) {
      const completed = sessionStorage.getItem("rakku_welcome_completed");
      if (completed === "true") {
        setHasInitializedWelcome(true);
        setShowWelcomeCard(false);
        const welcomeMsg = getLocalizedWelcome();
        if (messages.length === 0) {
          setMessages([{ role: "assistant", text: welcomeMsg, avatarState: "IDLE" }]);
          setCurrentAvatarState("IDLE");
          setCurrentSpeechBubble(welcomeMsg);
        }
      } else {
        setShowWelcomeCard(true);
      }
    }
  }, [selectedLanguage]);

  const handleWelcomeComplete = () => {
    setShowWelcomeCard(false);
    setHasInitializedWelcome(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("rakku_welcome_completed", "true");
    }
    const welcomeMsg = getLocalizedWelcome();
    setMessages([{ role: "assistant", text: welcomeMsg, avatarState: "IDLE" }]);
    updateAvatarAndSpeech("IDLE", welcomeMsg);
  };

  // Thinking messages rotation interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (loading) {
      interval = setInterval(() => {
        setThinkingIndex((prev) => (prev + 1) % thinkingMessages.length);
      }, 1500);
    } else {
      setThinkingIndex(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading]);

  useEffect(() => {
    if (loading && currentAvatarState === "THINKING") {
      setCurrentSpeechBubble(thinkingMessages[thinkingIndex]);
    }
  }, [loading, thinkingIndex, currentAvatarState]);

  const getLocalizedSuggestions = (lang: string) => {
    if (lang === "hi") {
      return [
        "🚔 शिकायत दर्ज करें",
        "📋 आवेदन की स्थिति",
        "📍 नजदीकी थाना खोजें",
        "🏠 किरायेदार सत्यापन",
        "📜 चरित्र प्रमाण पत्र",
        "🎭 कार्यक्रम अनुमति",
        "🆘 आपातकालीन सहायता"
      ];
    }
    return [
      "🚔 File Complaint",
      "📋 Track Application Status",
      "📍 Find Nearby Police Station",
      "🏠 Tenant Verification",
      "📜 Character Certificate",
      "🎭 Event Permission",
      "🆘 Emergency Help"
    ];
  };

  // Handle localized welcome message updates when language changes
  useEffect(() => {
    if (selectedLanguage && hasInitializedWelcome) {
      setMessages(prev => {
        const localizedMsg = getLocalizedWelcome();
        if (prev.length === 0) {
          return [{ role: "assistant", text: localizedMsg, avatarState: "WELCOME" }];
        }
        // If the first message is from the assistant and we are just starting out
        if (prev[0].role === "assistant" && prev.length === 1) {
          const updated = [...prev];
          updated[0].text = localizedMsg;
          updated[0].avatarState = "WELCOME";
          return updated;
        }
        return prev;
      });
      
      setSuggestions(getLocalizedSuggestions(selectedLanguage));
    }
  }, [selectedLanguage, hasInitializedWelcome]);

  // Handle triggered query from dashboard
  useEffect(() => {
    if (triggerQuery && sessionId && messages.length === 1 && selectedLanguage) {
      handleSendMessage(triggerQuery);
    }
  }, [triggerQuery, sessionId, selectedLanguage]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Handle typing effect for streaming
  const typeMessage = (fullText: string, msgIndex: number) => {
    let currentText = "";
    let i = 0;
    const speed = 10; // ms per char

    const interval = setInterval(() => {
      if (i < fullText.length) {
        currentText += fullText.charAt(i);
        setMessages((prev) => {
          const updated = [...prev];
          updated[msgIndex] = {
            role: "assistant",
            text: currentText,
            isStreaming: true,
            avatarState: prev[msgIndex]?.avatarState || "TALKING",
          };
          return updated;
        });
        i++;
      } else {
        clearInterval(interval);
        setMessages((prev) => {
          const updated = [...prev];
          updated[msgIndex] = {
            role: "assistant",
            text: fullText,
            isStreaming: false,
            avatarState: prev[msgIndex]?.avatarState || "TALKING",
          };
          return updated;
        });
      }
    }, speed);
  };

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    const userText = textToSend;
    setInput("");

    // --- Intercept: Manual location input when waiting ---
    if (waitingForManualLocation) {
      setMessages((prev) => [...prev, { role: 'user', text: userText }]);
      setWaitingForManualLocation(false);

      if (userText.toLowerCase().trim() === 'cancel') {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: '👮 Police station search cancelled. How else can I help you?' },
        ]);
        updateAvatarAndSpeech("TALKING", "Police station search cancelled. How else can I assist you?");
        return;
      }

      await searchByCity(userText);
      return;
    }

    const cleanLower = userText.toLowerCase().trim();

    // Gap 4 Accessibility Announcements
    if (cleanLower.includes("use my verified details") || cleanLower.includes("मेरे सत्यापित विवरण") || cleanLower.includes("option:use my verified details")) {
      Announcements.announce("Verified details loaded successfully.", "polite");
    } else if (cleanLower.includes("apply for someone else") || cleanLower.includes("किसी अन्य व्यक्ति") || cleanLower.includes("kisi aur ke liye") || cleanLower.includes("option:apply for someone else")) {
      Announcements.announce("Manual entry selected.", "polite");
    }

    // --- SOS Intercept ---
    const isSosQuery = 
      cleanLower.includes('emergency help') || 
      cleanLower.includes('sos') || 
      cleanLower.includes('आपातकालीन सहायता');
      
    if (isSosQuery) {
      handleSOS();
      return;
    }


    // --- Police Station trigger keywords ---
    const isPoliceStationQuery =
      cleanLower.includes('nearest police station') ||
      cleanLower.includes('police station near me') ||
      cleanLower.includes('closest station') ||
      cleanLower.includes('find police station') ||
      cleanLower === '📍 find police station' ||
      cleanLower.includes('नजदीकी थाना') ||
      cleanLower.includes('थाना खोजें') ||
      cleanLower.includes('निकटतम पुलिस स्टेशन');

    if (isPoliceStationQuery) {
      setMessages((prev) => [...prev, { role: 'user', text: userText }]);
      setLoading(true);
      updateAvatarAndSpeech("THINKING", "Please wait while I locate the nearest police station.");

      // Step A: Try GPS with a 10-second timeout
      const gpsResult = await new Promise<{ success: boolean; lat?: number; lng?: number; reason?: string }>(
        (resolve) => {
          if (typeof window === 'undefined' || !navigator.geolocation) {
            resolve({ success: false, reason: 'unsupported' });
            return;
          }

          const timeoutId = setTimeout(() => {
            resolve({ success: false, reason: 'timeout' });
          }, 10000);

          navigator.geolocation.getCurrentPosition(
            (position) => {
              clearTimeout(timeoutId);
              resolve({
                success: true,
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              });
            },
            (error) => {
              clearTimeout(timeoutId);
              const reason =
                error.code === error.PERMISSION_DENIED
                  ? 'denied'
                  : error.code === error.TIMEOUT
                    ? 'timeout'
                    : 'unavailable';
              resolve({ success: false, reason });
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        }
      );

      // Step B: If GPS succeeded, call the API with coords
      if (gpsResult.success && gpsResult.lat && gpsResult.lng) {
        try {
          const res = await fetch(
            `${BACKEND_URL}/citizen-assistance/police-stations/nearest?lat=${gpsResult.lat}&lng=${gpsResult.lng}`
          );
          const data = await res.json();

          if (data.success && data.station) {
            if (data.demoMode) trackTelemetry('demo_mode_triggered');
            const text = formatStationMessage(data, 'GPS');
            setMessages((prev) => [...prev, { role: 'assistant', text }]);
            updateAvatarAndSpeech("SUCCESS", `I successfully located the nearest police station: ${data.station.name}.`);
          } else {
            // Structured error from backend → fall through to manual
            const text = '👮 I couldn\'t find a police station near your GPS coordinates.\n\nPlease enter your **area, city, or district** so I can search manually.\n\n**Examples:** Gomti Nagar, Lucknow · Sector 62, Noida · Varanasi';
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                text,
              },
            ]);
            setWaitingForManualLocation(true);
            updateAvatarAndSpeech("POINTING", "Please enter your area, city, or district so I can search manually.");
          }
        } catch (e: any) {
          trackTelemetry('police_station_api_failure', e?.message || 'unknown');
          const text = '👮 I couldn\'t reach the police station service right now.\n\nPlease enter your **area, city, or district** and I\'ll try a manual search.\n\n**Examples:** Lucknow · Kanpur · Noida';
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              text,
            },
          ]);
          setWaitingForManualLocation(true);
          updateAvatarAndSpeech("POINTING", "Please enter your area, city, or district and I'll search manually.");
        }
        setLoading(false);
        return;
      }

      // Step C: GPS failed — fire telemetry and ask for manual input
      if (gpsResult.reason === 'denied') {
        trackTelemetry('location_permission_denied');
      } else if (gpsResult.reason === 'timeout') {
        trackTelemetry('geolocation_timeout');
      }

      // Also check if we have coords from the initial page-load geolocation
      if (coords?.latitude && coords?.longitude) {
        try {
          const res = await fetch(
            `${BACKEND_URL}/citizen-assistance/police-stations/nearest?lat=${coords.latitude}&lng=${coords.longitude}`
          );
          const data = await res.json();
          if (data.success && data.station) {
            if (data.demoMode) trackTelemetry('demo_mode_triggered');
            const text = formatStationMessage(data, 'Saved Location');
            setMessages((prev) => [...prev, { role: 'assistant', text }]);
            setLoading(false);
            updateAvatarAndSpeech("SUCCESS", `Located nearest police station: ${data.station.name}.`);
            return;
          }
        } catch { /* fall through to manual prompt */ }
      }

      const text = '👮 I couldn\'t access your location automatically.\n\nPlease tell me your **area, city, or district** so I can find the nearest police station for you.\n\n**Examples:**\n- Gomti Nagar, Lucknow\n- Sector 62, Noida\n- Varanasi\n- Kanpur\n\nOr type **cancel** to go back.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text,
        },
      ]);
      setWaitingForManualLocation(true);
      setLoading(false);
      updateAvatarAndSpeech("POINTING", "Please tell me your area, city, or district so I can locate the nearest police station.");
      return;
    }
    
    // Add user message
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setLoading(true);
    updateAvatarAndSpeech("THINKING", "Please wait while I process your request.");

    // Add empty assistant message for streaming placeholder
    const placeholderIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: "assistant", text: "...", isStreaming: true, avatarState: "THINKING" }]);

    try {
      const data = await ChatService.sendMessage(
        userText,
        sessionId,
        coords?.latitude || undefined,
        coords?.longitude || undefined,
        selectedLanguage || undefined
      );
      
      // Remove loading status
      setLoading(false);
      
      // Update placeholder with correct avatar state before typing starts
      setMessages((prev) => {
        const updated = [...prev];
        updated[placeholderIndex] = {
          ...updated[placeholderIndex],
          avatarState: data.avatar_state || "TALKING",
        };
        return updated;
      });

      // Update with typing effect
      typeMessage(data.response, placeholderIndex);
      updateAvatarAndSpeech(data.avatar_state || "TALKING", data.response);

      if (data.suggestions) {
        setSuggestions(data.suggestions);
      }
    } catch (e) {
      setLoading(false);
      setMessages((prev) => {
        const updated = [...prev];
        updated[placeholderIndex] = {
          role: "assistant",
          text: "👮 **Rakku System:** Sorry, I encountered an error connecting to the server. Please check your network and try again.",
        };
        return updated;
      });
      updateAvatarAndSpeech("ERROR", "I am currently unable to process your request. Please try again shortly.");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  const startNewChat = () => {
    setSessionId(`session-${Math.random().toString(36).substring(7)}`);
    setHasInitializedWelcome(false); // restarts Salute -> Welcome -> Idle
    if (selectedLanguage) {
      setMessages([
        {
          role: "assistant",
          text: getLocalizedWelcome(),
          avatarState: "SALUTE",
        },
      ]);
      setSuggestions(getLocalizedSuggestions(selectedLanguage));
    } else {
      setMessages([]);
      setSuggestions([]);
    }
  };

  const loadHistorySession = (sessionTitle: string) => {
    setSessionId(`session-${Math.random().toString(36).substring(7)}`);
    const welcomeMsg = `👮 **Welcome back. Loading session: ${sessionTitle}**\nHow can I assist you with this request? You can continue or ask something new.`;
    setMessages([
      {
        role: "assistant",
        text: welcomeMsg,
        avatarState: "WELCOME",
      },
    ]);
    updateAvatarAndSpeech("WELCOME", `Welcome back! Loading session: ${sessionTitle}`);
  };

  if (!selectedLanguage) {
    return <LanguageSelector />;
  }

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Mobile Sidebar Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden absolute top-4 left-4 z-50 p-2 bg-slate-900 border border-slate-700 text-slate-300 rounded-lg hover:text-white"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Sidebar Panel */}
      <aside className={`w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between flex-shrink-0 z-40 transition-transform duration-300 absolute md:relative inset-y-0 left-0 transform md:transform-none ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="p-4 flex flex-col h-full">
          {/* New Chat Button */}
          <button
            onClick={startNewChat}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-755 border border-slate-700 rounded-lg text-xs font-semibold text-white transition-all flex items-center justify-center space-x-2 shadow hover:border-police-gold"
          >
            <span>+</span>
            <span>New Chat Session</span>
          </button>

          {/* History List */}
          <div className="mt-8 flex-1 overflow-y-auto">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-3">
              Conversation History
            </h4>
            <div className="space-y-1">
              {history.map((sess) => (
                <button
                  key={sess.id}
                  onClick={() => loadHistorySession(sess.title)}
                  className="w-full text-left px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 text-xs flex items-center space-x-2 transition-all group"
                >
                  <MessageSquare className="w-4 h-4 text-slate-500 group-hover:text-police-gold transition-colors" />
                  <span className="truncate flex-1">{sess.title}</span>
                  <span className="text-[9px] text-slate-600 font-medium">{sess.date}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Info / Warning Panel */}
          <div className="mt-auto border-t border-slate-800 pt-4 bg-slate-900">
            <div className="bg-police-navy-light/40 border border-police-gold/15 rounded-lg p-3 text-[10px] text-slate-400 leading-relaxed">
              <div className="flex items-center space-x-1.5 text-police-gold font-semibold mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Rakku Guidelines</span>
              </div>
              <p>One question at a time. Cancel a workflow by typing <strong className="text-slate-200 font-mono">cancel</strong>. Emergency dial 112.</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col bg-police-navy-dark overflow-hidden h-full">
        {/* Workspace Header */}
        <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-police-navy/40">
          <div className="flex items-center space-x-2 pl-12 md:pl-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-semibold text-slate-300">Rakku Chat Assistant</span>
          </div>

          <div className="flex items-center space-x-4">
            <LanguageBadge />
            <button
              onClick={() => {
                setMessages([]);
                startNewChat();
              }}
              title="Clear chat history"
              className="p-1.5 hover:bg-slate-800 text-slate-500 hover:text-police-red rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, idx) => {
              const isAssistant = msg.role === "assistant";
              
              // Find the index of the latest assistant message
              const latestAssistantIdx = [...messages].reverse().findIndex(m => m.role === 'assistant');
              const latestAssistantIndexInArray = latestAssistantIdx !== -1 ? messages.length - 1 - latestAssistantIdx : -1;
              const isLatestAssistant = isAssistant && idx === latestAssistantIndexInArray;

              return (
                <ChatMessage
                  key={idx}
                  msg={msg}
                  idx={idx}
                  isLatestAssistant={isLatestAssistant}
                  onOptionClick={handleSendMessage}
                  translate={translate}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input & Suggestions Pane */}
        <footer className="border-t border-slate-800 p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="max-w-3xl mx-auto">
            {/* Suggested prompts list */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 max-h-24 overflow-y-auto py-1">
                {suggestions.map((sug, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(sug)}
                    className="px-3.5 py-1.5 bg-slate-800 border border-police-gold/30 text-[12px] font-medium text-slate-200 hover:text-white hover:bg-police-gold/15 hover:border-police-gold rounded-full transition-all flex items-center space-x-2 shadow-md hover:shadow-police-gold/10 active:scale-95 cursor-pointer"
                  >
                    <span className="text-police-gold text-[10px]">✦</span>
                    <span className="truncate">{sug}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Input Bar */}
            <div className="relative flex items-center bg-slate-900 border border-slate-700/80 rounded-xl focus-within:border-police-gold transition-colors p-1.5 shadow-lg">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Type your message (e.g. 'My phone was stolen' or 'किरायेदार सत्यापन')"
                className="flex-1 bg-transparent border-0 outline-none text-slate-100 placeholder-slate-500 text-xs sm:text-sm pl-3 pr-12 py-2 resize-none max-h-20 focus:ring-0 focus:outline-none"
                rows={1}
              />
              <button
                onClick={() => handleSendMessage(input)}
                disabled={!input.trim() || loading}
                className="p-2.5 bg-police-gold hover:bg-police-gold-light text-police-navy-dark rounded-lg disabled:bg-slate-800 disabled:text-slate-600 transition-colors shadow"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-between text-[9px] text-slate-500 mt-2 px-1">
              <span>Press <strong className="text-slate-400 font-mono">Enter</strong> to send, <strong className="text-slate-400 font-mono">Shift + Enter</strong> for line break.</span>
              <span className="hidden sm:inline">👮 Rakku Assistant V1 Prototype</span>
            </div>
          </div>
        </footer>
      </div>

      {isEmergencyDialogOpen && (
        <SOSDialog 
          activeAlertId={activeAlertId} 
          initialReferenceNumber={initialReferenceNumber}
          backendUrl={BACKEND_URL}
          onClose={() => setIsEmergencyDialogOpen(false)} 
        />
      )}

      {/* Floating Welcome Overlay Greeting Card */}
      {showWelcomeCard && (
        <RakkuWelcomeCard onComplete={handleWelcomeComplete} />
      )}
    </div>
  );
}

// Main Page wrapper providing Suspense context for useSearchParams
export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-police-navy-dark text-slate-400 text-sm">
        Loading Chat Workspace...
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
