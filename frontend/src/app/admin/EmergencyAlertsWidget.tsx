"use client";

import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Clock, MapPin, CheckCircle, ShieldCheck, Volume2, VolumeX, Mail, Send, LayoutDashboard } from "lucide-react";
import { EmergencyService } from "../../services/api";
import { io } from "socket.io-client";

export default function EmergencyAlertsWidget() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [stats, setStats] = useState({ active: 0, acknowledged: 0, resolvedToday: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const sirenRef = useRef<HTMLAudioElement | null>(null);

  // Current time for live timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Initialize audio element
    if (typeof window !== "undefined") {
      sirenRef.current = new Audio("https://actions.google.com/sounds/v1/alarms/spaceship_alarm.ogg");
      sirenRef.current.loop = true;
    }

    const fetchData = async () => {
      try {
        const [active, dashboardStats] = await Promise.all([
          EmergencyService.getActiveAlerts(),
          EmergencyService.getStats()
        ]);
        setAlerts(active || []);
        setStats(dashboardStats || { active: 0, acknowledged: 0, resolvedToday: 0 });
      } catch (err) {
        console.error("Failed to fetch alerts", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    // Setup socket.io
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    const socketUrl = backendUrl.replace('/api', '');
    const socket = io(`${socketUrl}/emergency`, {
      transports: ["websocket"]
    });

    socket.on("new_alert", (alert) => {
      setAlerts(prev => [alert, ...prev]);
      setStats(prev => ({ ...prev, active: prev.active + 1 }));
    });

    socket.on("alert_updated", (alert) => {
      if (alert.status === 'RESOLVED') {
        setAlerts(prev => prev.filter(a => a.id !== alert.id));
        setStats(prev => ({ ...prev, resolvedToday: prev.resolvedToday + 1, acknowledged: Math.max(0, prev.acknowledged - 1) }));
      } else {
        setAlerts(prev => prev.map(a => a.id === alert.id ? alert : a));
      }
    });

    return () => {
      socket.disconnect();
      if (sirenRef.current) {
        sirenRef.current.pause();
      }
    };
  }, []);

  // Play siren if there is an unacknowledged active alert
  useEffect(() => {
    const hasActiveUnacknowledged = alerts.some(a => a.status === 'ACTIVE' && !a.adminAcknowledged);
    if (hasActiveUnacknowledged && !muted && sirenRef.current) {
      sirenRef.current.play().catch(e => console.warn("Autoplay blocked", e));
    } else if (sirenRef.current) {
      sirenRef.current.pause();
    }
  }, [alerts, muted]);

  const handleAcknowledge = async (id: string) => {
    await EmergencyService.acknowledgeAlert(id, "admin_user_1");
    setStats(prev => ({ ...prev, active: Math.max(0, prev.active - 1), acknowledged: prev.acknowledged + 1 }));
  };

  const handleResolve = async (id: string) => {
    await EmergencyService.resolveAlert(id, "admin_user_1");
    setStats(prev => ({ ...prev, acknowledged: Math.max(0, prev.acknowledged - 1), resolvedToday: prev.resolvedToday + 1 }));
    setAlerts(alerts.filter(a => a.id !== id));
  };

  const formatElapsed = (createdAt: string) => {
    const diff = Math.floor((now - new Date(createdAt).getTime()) / 1000);
    if (diff < 0) return "Just now";
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')} ago`;
  };

  if (loading) {
    return <div className="text-center py-4 text-slate-400">Loading Active Alerts...</div>;
  }

  return (
    <div className="mb-8">
      {/* Widget Header with Stats and Siren Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
        <h2 className="text-xl font-bold text-police-red-light flex items-center gap-2">
          <AlertCircle className="w-6 h-6 animate-pulse" />
          🚨 EMERGENCY RESPONSE DESK
        </h2>

        <div className="flex items-center gap-4 bg-slate-900 p-2 rounded-lg border border-slate-700">
          <div className="flex gap-3 text-xs font-bold">
            <span className="text-police-red-light">🔴 Active: {stats.active}</span>
            <span className="text-amber-500">🟡 Acknowledged: {stats.acknowledged}</span>
            <span className="text-emerald-500">🟢 Resolved Today: {stats.resolvedToday}</span>
          </div>
          <div className="w-px h-6 bg-slate-700 mx-1"></div>
          <button 
            onClick={() => setMuted(!muted)}
            className={`p-1.5 rounded-full transition-colors ${muted ? 'bg-slate-700 text-slate-400' : 'bg-police-red/20 text-police-red-light hover:bg-police-red/30'}`}
            title={muted ? "Unmute Siren" : "Mute Siren"}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-slate-900/50 border border-emerald-500/30 rounded-lg p-6 text-center text-emerald-400">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">All Clear</p>
          <p className="text-xs opacity-70">No active emergency alerts at this time.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {alerts.map(alert => (
            <div key={alert.id} className={`border-l-4 rounded-lg p-4 shadow-lg flex flex-col md:flex-row gap-4 justify-between items-start md:items-center transition-all ${
              alert.status === 'ACTIVE' 
                ? 'bg-police-red/10 border-police-red-light' 
                : 'bg-amber-500/10 border-amber-500'
            }`}>
              
              {/* Quick Summary */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded ${alert.status === 'ACTIVE' ? 'bg-police-red-light animate-pulse' : 'bg-amber-500'}`}>
                    {alert.status}
                  </span>
                  <span className="font-mono text-sm font-bold text-white tracking-wider bg-slate-800 px-2 py-0.5 rounded border border-slate-600">
                    {alert.referenceNumber}
                  </span>
                  {alert.sosPressCount > 1 && (
                    <span className="bg-police-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse">
                      SOS ×{alert.sosPressCount}
                    </span>
                  )}
                  <span className="text-xs font-mono text-slate-300 flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded">
                    <Clock className="w-3 h-3 text-amber-500" />
                    {formatElapsed(alert.createdAt)}
                  </span>
                </div>
                <p className="text-white font-semibold">
                  {alert.citizenSnapshot?.fullName || 'Unknown Citizen'} - <span className="font-mono text-police-gold">{alert.citizenSnapshot?.mobileNumber || 'Unknown Mobile'}</span>
                </p>
                <p className="text-sm text-slate-300 flex items-center gap-1 mt-1 font-mono">
                  <MapPin className="w-4 h-4 text-police-gold" />
                  {alert.latitude ? `${alert.latitude.toFixed(6)}, ${alert.longitude.toFixed(6)}` : (alert.locationText || 'Location Pending')}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 w-full md:w-auto">
                {alert.status === 'ACTIVE' && (
                  <button
                    onClick={() => handleAcknowledge(alert.id)}
                    className="flex-1 md:flex-none bg-amber-500 hover:bg-amber-400 text-slate-900 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    ACKNOWLEDGE
                  </button>
                )}
                {alert.status === 'ACKNOWLEDGED' && (
                  <button
                    onClick={() => handleResolve(alert.id)}
                    className="flex-1 md:flex-none bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-emerald-600"
                  >
                    <CheckCircle className="w-4 h-4" />
                    RESOLVE
                  </button>
                )}
                <button
                  onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                  className="flex-1 md:flex-none bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                >
                  {expandedId === alert.id ? 'HIDE DETAILS' : 'VIEW DETAILS'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded View Modal/Section */}
      {expandedId && (
        <div className="mt-4 bg-slate-900 border border-slate-700 p-6 rounded-xl shadow-2xl relative animate-in fade-in slide-in-from-top-2">
          <button 
            onClick={() => setExpandedId(null)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white"
          >
            ✕
          </button>
          
          {(() => {
            const current = alerts.find(a => a.id === expandedId);
            if (!current) return null;
            
            // Check delivery statuses
            const deliveredDash = current.events?.some((e: any) => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Dashboard');
            const deliveredTg = current.events?.some((e: any) => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Telegram');
            const deliveredEmail = current.events?.some((e: any) => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Email');

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-police-gold font-bold mb-3 border-b border-slate-700 pb-2">Emergency Details</h3>
                  <div className="space-y-2 text-sm text-slate-300">
                    <p><strong className="text-white">Type:</strong> {current.emergencyType || 'Pending classification'}</p>
                    <p><strong className="text-white">Severity:</strong> {current.severity}</p>
                    <p><strong className="text-white">Trigger:</strong> {current.triggerSource}</p>
                    <p><strong className="text-white">SOS Presses:</strong> {current.sosPressCount}</p>
                  </div>
                  
                  <h3 className="text-police-gold font-bold mt-6 mb-3 border-b border-slate-700 pb-2">Citizen Profile</h3>
                  <div className="space-y-2 text-sm text-slate-300">
                    <p><strong className="text-white">Name:</strong> {current.citizenSnapshot?.fullName}</p>
                    <p><strong className="text-white">Mobile:</strong> {current.citizenSnapshot?.mobileNumber}</p>
                    <p><strong className="text-white">Address:</strong> {current.citizenSnapshot?.addressLine1 || 'N/A'}</p>
                  </div>

                  <h3 className="text-police-gold font-bold mt-6 mb-3 border-b border-slate-700 pb-2">Notification Status</h3>
                  <div className="flex gap-4 text-xs font-mono">
                    <span className={`flex items-center gap-1 ${deliveredDash ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <LayoutDashboard className="w-3 h-3" /> Dashboard
                    </span>
                    <span className={`flex items-center gap-1 ${deliveredTg ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <Send className="w-3 h-3" /> Telegram
                    </span>
                    <span className={`flex items-center gap-1 ${deliveredEmail ? 'text-emerald-400' : 'text-amber-500'}`}>
                      <Mail className="w-3 h-3" /> Email
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="text-police-gold font-bold mb-3 border-b border-slate-700 pb-2">Audit Timeline</h3>
                  <div className="bg-slate-950 p-4 rounded border border-slate-800 h-64 overflow-y-auto space-y-3 font-mono text-[10px]">
                    {current.events?.map((evt: any) => (
                      <div key={evt.id} className="border-l-2 border-slate-600 pl-3 py-1">
                        <p className="text-slate-500 mb-0.5">{new Date(evt.createdAt).toLocaleString()}</p>
                        <p className="font-bold text-amber-500">{evt.eventType}</p>
                        {Object.keys(evt.metadata || {}).length > 0 && (
                          <pre className="text-slate-400 mt-1 overflow-x-auto">
                            {JSON.stringify(evt.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                    {(!current.events || current.events.length === 0) && (
                      <p className="text-slate-500 italic">No events recorded.</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
