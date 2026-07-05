"use client";

import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Clock, MapPin, CheckCircle, ShieldCheck, Volume2, VolumeX, Mail, Send, LayoutDashboard } from "lucide-react";
import { EmergencyService } from "../../services/api";
import { io } from "socket.io-client";

export default function EmergencyAlertsWidget({ onSelectAlert }: { onSelectAlert?: (alert: any) => void }) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED'>('ALL');
  const [newUnseenAlert, setNewUnseenAlert] = useState<boolean>(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState({ active: 0, acknowledged: 0, resolvedToday: 0, cancelledToday: 0 });
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
        const [recent, dashboardStats] = await Promise.all([
          EmergencyService.getRecentAlerts(50),
          EmergencyService.getStats()
        ]);
        setAlerts(recent || []);
        setStats(dashboardStats || { active: 0, acknowledged: 0, resolvedToday: 0, cancelledToday: 0 });
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
      
      // Auto-scroll to top
      if (feedRef.current) {
        feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      
      // Notify if filter hides it
      setFilter(currentFilter => {
        if (currentFilter !== 'ALL' && currentFilter !== 'ACTIVE') {
          setNewUnseenAlert(true);
        }
        return currentFilter;
      });
    });

    socket.on("alert_updated", (alert) => {
      if (alert.status === 'RESOLVED') {
        setAlerts(prev => prev.map(a => a.id === alert.id ? alert : a));
        setStats(prev => ({ ...prev, resolvedToday: prev.resolvedToday + 1, acknowledged: Math.max(0, prev.acknowledged - 1) }));
      } else if (alert.status === 'CANCELLED') {
        setAlerts(prev => prev.map(a => a.id === alert.id ? alert : a));
        setStats(prev => ({ ...prev, cancelledToday: prev.cancelledToday + 1, active: Math.max(0, prev.active - 1) }));
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
    // Don't filter out anymore, let the backend/socket update status to RESOLVED
  };

  const formatElapsed = (createdAt: string) => {
    const diff = Math.floor((now - new Date(createdAt).getTime()) / 1000);
    if (diff < 10) return "Just now";
    if (diff < 60) return `${diff} sec ago`;
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    return `${hours} hr ago`;
  };

  if (loading) {
    return <div className="text-center py-4 text-slate-400">Loading Active Alerts...</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Widget Header */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-police-red-light uppercase tracking-widest flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-police-red-light opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-police-red"></span>
            </span>
            Live Emergency Feed
          </h2>
          <button 
            onClick={() => setMuted(!muted)}
            className={`p-1.5 rounded-full transition-colors ${muted ? 'bg-slate-200 dark:bg-slate-800 text-slate-500' : 'bg-police-red/20 text-police-red hover:bg-police-red/30'}`}
            title={muted ? "Unmute Siren" : "Mute Siren"}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
        
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider mb-3">
          <span className="text-police-red">🚨 Active: {stats.active}</span>
          <span className="text-amber-600 dark:text-amber-500">🟡 Ack: {stats.acknowledged}</span>
          <span className="text-emerald-600 dark:text-emerald-500">🟢 Res: {stats.resolvedToday}</span>
        </div>
        
        {/* Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide text-[10px] font-bold uppercase tracking-wider">
          <button onClick={() => setFilter('ALL')} className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors ${filter === 'ALL' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}>All</button>
          <button onClick={() => setFilter('ACTIVE')} className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors ${filter === 'ACTIVE' ? 'bg-police-red text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}>🔴 Active</button>
          <button onClick={() => setFilter('ACKNOWLEDGED')} className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors ${filter === 'ACKNOWLEDGED' ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}>🟡 Ack</button>
          <button onClick={() => setFilter('RESOLVED')} className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors ${filter === 'RESOLVED' ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}>🟢 Res</button>
          <button onClick={() => setFilter('CANCELLED')} className={`px-2 py-1 rounded-full whitespace-nowrap transition-colors ${filter === 'CANCELLED' ? 'bg-slate-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}>⚪ Canc</button>
        </div>
      </div>
      
      {/* New Alert Notification (if hidden by filter) */}
      {newUnseenAlert && filter !== 'ALL' && filter !== 'ACTIVE' && (
        <div className="bg-police-red text-white px-4 py-2 text-xs font-bold flex justify-between items-center animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-white animate-ping"></span> 1 New Active Emergency</span>
          <button onClick={() => { setFilter('ACTIVE'); setNewUnseenAlert(false); feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }} className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors">View</button>
        </div>
      )}

      {/* Feed List */}
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-100 dark:bg-slate-950">
        {alerts.filter(a => filter === 'ALL' || a.status === filter).length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-emerald-500 space-y-3 opacity-70 mt-10">
          <CheckCircle className="w-10 h-10" />
          <p className="text-sm font-bold uppercase tracking-widest">🟢 All Clear</p>
          <div className="text-center">
            <p className="text-xs text-slate-400">No active emergencies.</p>
            <p className="text-[10px] text-slate-500 mt-1">System is monitoring incoming alerts.</p>
          </div>
        </div>
      ) : (
          alerts.filter(a => filter === 'ALL' || a.status === filter).map(alert => {
            const isSOS = alert.status === 'ACTIVE';
            const isAck = alert.status === 'ACKNOWLEDGED';
            const isCancel = alert.status === 'CANCELLED';
            const isRes = alert.status === 'RESOLVED';
            const isNew = (now - new Date(alert.createdAt).getTime()) < 120000; // < 2 mins
            
            return (
              <div 
                key={alert.id} 
                className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 shadow-sm animate-in slide-in-from-top-4 fade-in duration-300 relative overflow-hidden group hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer ${isNew && isSOS ? 'ring-1 ring-police-red shadow-police-red/20 shadow-lg' : ''}`}
                onClick={() => {
                  setExpandedId(expandedId === alert.id ? null : alert.id);
                  if (onSelectAlert) onSelectAlert(alert);
                }}
              >
                {/* Left accent border */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                  isSOS ? 'bg-police-red animate-pulse' : 
                  isAck ? 'bg-amber-500' : 
                  isRes ? 'bg-emerald-500' : 'bg-slate-600'
                }`}></div>

                {/* Top Row */}
                <div className="flex justify-between items-start mb-2 pl-2">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${
                      isSOS ? 'bg-police-red animate-pulse' : 
                      isAck ? 'bg-amber-500' : 
                      isRes ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
                    }`}></span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white tracking-widest flex items-center gap-2">
                      {isSOS ? '🚨 SOS' : alert.status}
                      {isNew && isSOS && (
                        <span className="px-1.5 py-0.5 bg-police-red text-white text-[9px] rounded-sm animate-pulse">NEW</span>
                      )}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatElapsed(alert.createdAt)}
                  </span>
                </div>

                {/* Details */}
                <div className="pl-2 space-y-1 mt-3">
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-mono flex justify-between items-center">
                    <span className="truncate pr-2">{alert.locationText || 'Location Pending'}</span>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">{alert.referenceNumber}</span>
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                    {alert.emergencyType || 'Unclassified'} • {alert.citizenSnapshot?.mobileNumber || 'No Mobile'}
                  </p>
                </div>

                {/* Quick Actions (Inline) */}
                {(isSOS || isAck) && expandedId === alert.id && (
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 pl-2 flex gap-2 animate-in fade-in">
                    {isSOS && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAcknowledge(alert.id); }}
                        className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 px-3 py-2 rounded text-[10px] font-bold tracking-wider transition-colors"
                      >
                        ACKNOWLEDGE
                      </button>
                    )}
                    {isAck && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(alert.id); }}
                        className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-3 py-2 rounded text-[10px] font-bold tracking-wider transition-colors"
                      >
                        RESOLVE
                      </button>
                    )}
                  </div>
                )}
                
                {expandedId === alert.id && !isSOS && !isAck && (
                   <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 pl-2 text-[10px] text-slate-500 font-mono">
                     Citizen: {alert.citizenSnapshot?.fullName || 'Unknown'} <br/>
                     Resolved/Cancelled status.
                   </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
