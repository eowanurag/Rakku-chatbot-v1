import React, { useState, useEffect, useRef } from 'react';
import { useEmergencySocket, EmergencyAlertData } from '../hooks/useEmergencySocket';
import { EmergencyService } from '../services/api';
import { MapPin, Crosshair, XCircle, AlertTriangle, CheckCircle, ShieldAlert, Clock, LayoutDashboard, Send, Mail } from 'lucide-react';

interface SOSDialogProps {
  activeAlertId: string | null;
  initialReferenceNumber: string | null;
  backendUrl: string;
  onClose: () => void;
}

const SOSDialog: React.FC<SOSDialogProps> = ({ activeAlertId, initialReferenceNumber, backendUrl, onClose }) => {
  const { liveAlert, setLiveAlert } = useEmergencySocket(backendUrl, activeAlertId);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [manualLocation, setManualLocation] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [isForOther, setIsForOther] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const currentAlert = liveAlert || {
    id: activeAlertId || '',
    referenceNumber: initialReferenceNumber || 'Pending...',
    status: 'ACTIVE',
    adminAcknowledged: false,
    createdAt: new Date().toISOString()
  };

  const isCancelled = currentAlert.status === 'CANCELLED';
  const isAcknowledged = currentAlert.status === 'ACKNOWLEDGED' || currentAlert.adminAcknowledged;
  const isResolved = currentAlert.status === 'RESOLVED';
  const isActive = currentAlert.status === 'ACTIVE' && !isAcknowledged;

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !currentAlert.id) return;
    initializedRef.current = true;

    // Fetch full alert for delivery events
    fetch(`${backendUrl}/emergency/${currentAlert.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.events) setEvents(data.events);
        
        // Extract mobile number if present
        if (data.citizenSnapshot?.mobileNumber && data.citizenSnapshot.mobileNumber !== 'Pending') {
          setMobileNumber(prev => prev || data.citizenSnapshot.mobileNumber);
        }
      })
      .catch(console.error);

    // Auto GPS Request
    if (!currentAlert.latitude && !isCancelled && !isResolved) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            try {
              await EmergencyService.updateLocation(currentAlert.id, position.coords.latitude, position.coords.longitude, 'GPS');
              setGpsLoading(false);
              setLiveAlert(prev => prev ? { ...prev, latitude: position.coords.latitude, longitude: position.coords.longitude } : null);
            } catch (e: any) {
              setGpsDenied(true);
              setGpsLoading(false);
            }
          },
          (err) => {
            setGpsDenied(true);
            setGpsLoading(false);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } else {
        setGpsDenied(true);
        setGpsLoading(false);
      }
    } else {
      setGpsLoading(false);
    }
  }, [currentAlert.id]);

  useEffect(() => {
    const start = new Date(currentAlert.createdAt).getTime();
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentAlert.createdAt]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleShareGPS = () => {
    if (gpsLoading || isCancelled || isResolved) return;
    setGpsLoading(true);
    setGpsDenied(false);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            await EmergencyService.updateLocation(currentAlert.id, position.coords.latitude, position.coords.longitude, 'GPS');
            setGpsLoading(false);
            setLiveAlert(prev => prev ? { ...prev, latitude: position.coords.latitude, longitude: position.coords.longitude } : null);
          } catch (e: any) {
            setErrorMsg(e.message || 'Failed to update location');
            setGpsLoading(false);
            setGpsDenied(true);
          }
        },
        (err) => {
          setErrorMsg('Location permission denied. Please allow it in settings.');
          setGpsLoading(false);
          setGpsDenied(true);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  };

  const handleSelectType = async (type: string) => {
    if (loading || isCancelled || isResolved) return;
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/emergency/${currentAlert.id}/emergency-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emergencyType: type })
      });
      if (!res.ok) throw new Error('Failed to update type');
      setLiveAlert(prev => prev ? { ...prev, emergencyType: type } : null);
    } catch (e: any) {
      setErrorMsg(e.message || 'Error updating emergency type');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAlert = async () => {
    if (loading || isCancelled || isResolved) return;
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/emergency/${currentAlert.id}/cancel`, {
        method: 'PATCH'
      });
      if (!res.ok) {
        throw new Error('Alert has already been acknowledged or cannot be cancelled.');
      }
      setLiveAlert(prev => prev ? { ...prev, status: 'CANCELLED' } : null);
    } catch (e: any) {
      setErrorMsg(e.message || 'Error cancelling alert');
    } finally {
      setLoading(false);
      setShowCancelConfirm(false);
    }
  };

  const handleUpdateDetails = async () => {
    if (loading || isCancelled || isResolved) return;
    setLoading(true);
    try {
      const details: any = {};
      if (manualLocation.trim()) details.locationText = manualLocation;
      if (mobileNumber.trim()) details.mobileNumber = mobileNumber;
      details.isForOther = isForOther;

      await EmergencyService.updateDetails(currentAlert.id, details);
      
      // Update local state if needed
      setLiveAlert(prev => {
        if (!prev) return null;
        const updated = { ...prev };
        if (details.locationText) updated.locationText = details.locationText;
        return updated;
      });
      setErrorMsg('');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update details');
    } finally {
      setLoading(false);
    }
  };

  const deliveredDash = events.some(e => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Dashboard');
  const deliveredTg = events.some(e => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Telegram');
  const failedTg = events.some(e => e.eventType === 'NOTIFICATION_FAILED' && e.metadata?.channel === 'Telegram');
  const deliveredEmail = events.some(e => e.eventType === 'NOTIFICATION_SENT' && e.metadata?.channel === 'Email');

  const renderTimeline = () => (
    <div className="w-full text-left bg-slate-950/50 p-4 rounded-xl border border-slate-700/50 space-y-4">
      <div className="flex items-center space-x-3 text-sm text-green-400">
        <CheckCircle className="w-5 h-5" /> <span className="font-bold">Alert Sent</span>
      </div>
      
      <div className={`flex items-center space-x-3 text-sm ${liveAlert?.latitude ? 'text-green-400' : 'text-slate-500'}`}>
        {liveAlert?.latitude ? <CheckCircle className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-600"></div>} 
        <span className="font-bold">Location Updated {liveAlert?.latitude && <span className="text-xs text-green-500 font-normal ml-2 bg-green-900/30 px-2 py-0.5 rounded">High Accuracy</span>}</span>
      </div>
      
      <div className={`flex items-center space-x-3 text-sm ${isAcknowledged ? 'text-yellow-400' : 'text-slate-500'}`}>
        {isAcknowledged ? <CheckCircle className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-600"></div>}
        <span className="font-bold">Control Room Acknowledged</span>
      </div>

      <div className={`flex items-center space-x-3 text-sm ${isResolved ? 'text-green-400' : 'text-slate-500'}`}>
        {isResolved ? <CheckCircle className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-600"></div>}
        <span className="font-bold">Assistance Dispatched / Resolved</span>
      </div>

      {isCancelled && (
        <div className="flex items-center space-x-3 text-sm text-slate-400 pt-3 border-t border-slate-800">
          <XCircle className="w-5 h-5" /> <span className="font-bold">Alert Cancelled by Citizen</span>
        </div>
      )}
    </div>
  );

  const types = [
    { label: 'Crime', value: 'CRIME', icon: '🚓' },
    { label: 'Medical', value: 'MEDICAL', icon: '🚑' },
    { label: 'Fire', value: 'FIRE', icon: '🔥' },
    { label: 'Accident', value: 'ACCIDENT', icon: '🚗' },
    { label: 'Women\'s Safety', value: 'WOMEN_SAFETY', icon: '👩' },
    { label: 'Child', value: 'CHILD', icon: '👶' },
    { label: 'Other', value: 'OTHER', icon: '⚠' }
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className={`p-4 flex items-center justify-between ${isCancelled ? 'bg-slate-800' : 'bg-gradient-to-r from-red-600 to-red-800 border-b border-red-900 shadow-md'}`}>
          <div className="flex items-center space-x-3">
            <ShieldAlert className={`w-6 h-6 ${isCancelled ? 'text-slate-400' : 'text-white animate-pulse'}`} />
            <h2 className="text-lg font-bold text-white tracking-wide drop-shadow-md">
              {isCancelled ? 'Alert Cancelled' : '🚨 Emergency Alert Sent'}
            </h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition ${isCancelled ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-red-100 hover:text-white hover:bg-red-900/50'}`}>
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex flex-col items-center justify-center text-center space-y-3 shadow-inner">
            <div className="text-slate-400 text-xs font-mono tracking-widest uppercase">Reference Number</div>
            <div className="text-2xl font-mono font-bold text-white">{currentAlert.referenceNumber}</div>
            
            {!isCancelled && !isResolved && (
              <div className="flex items-center space-x-2 text-red-400 font-mono font-bold bg-red-950/40 px-3 py-1 rounded-full border border-red-900/50 mt-1">
                <Clock className="w-4 h-4 animate-pulse" />
                <span>Emergency Active - {formatTime(elapsed)}</span>
              </div>
            )}
            
            <p className="text-green-400 text-xs font-medium mt-2">
              ✅ Your emergency alert has been successfully delivered to the control authority.
            </p>
            <p className="text-slate-400 text-xs">
              Please keep this window open if it is safe to do so.<br/>
              You may optionally provide additional information below.
            </p>
          </div>

          {errorMsg && (
            <div className="bg-red-900/50 border border-red-500/50 text-red-200 text-xs p-3 rounded-lg text-center">
              {errorMsg}
            </div>
          )}

          {renderTimeline()}

          {events.length > 0 && !isCancelled && (
            <div className="bg-slate-900/30 border border-slate-700/50 p-3 rounded-xl text-xs flex flex-col space-y-2">
              <span className="text-slate-500 font-bold uppercase tracking-wider mb-1">Alert Delivered To:</span>
              <div className="flex space-x-4">
                <span className={`flex items-center gap-1 ${deliveredDash ? 'text-green-400' : 'text-slate-600'}`}>
                  {deliveredDash ? <CheckCircle className="w-3 h-3" /> : <LayoutDashboard className="w-3 h-3" />} Dashboard
                </span>
                <span className={`flex items-center gap-1 ${deliveredTg ? 'text-green-400' : failedTg ? 'text-yellow-500' : 'text-slate-600'}`}>
                  {deliveredTg ? <CheckCircle className="w-3 h-3" /> : failedTg ? <AlertTriangle className="w-3 h-3" /> : <Send className="w-3 h-3" />} 
                  Telegram
                </span>
                <span className={`flex items-center gap-1 ${deliveredEmail ? 'text-green-400' : 'text-slate-600'}`}>
                  {deliveredEmail ? <CheckCircle className="w-3 h-3" /> : <Mail className="w-3 h-3" />} Email
                </span>
              </div>
            </div>
          )}

          <div className={`space-y-6 ${isCancelled || isResolved ? 'opacity-50 pointer-events-none' : ''}`}>
            {gpsLoading ? (
              <div className="bg-slate-800 p-4 rounded-xl text-center border border-slate-700 animate-pulse">
                <p className="text-sm font-bold text-slate-300">Obtaining your location...</p>
                <p className="text-xs text-slate-500 mt-1">📍 Requesting GPS permission...</p>
              </div>
            ) : liveAlert?.latitude ? (
              <div className="bg-green-900/20 border border-green-500/30 p-4 rounded-xl text-center">
                <p className="text-sm font-bold text-green-400">✅ Current location shared.</p>
                <p className="text-xs text-slate-400 mt-1">Authorities can track your position.</p>
              </div>
            ) : gpsDenied ? (
              <div className="space-y-3">
                <button 
                  onClick={handleShareGPS}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white rounded-xl font-bold transition flex items-center justify-center shadow-lg active:scale-95"
                >
                  <MapPin className="w-5 h-5 mr-2"/> Retry Sharing GPS
                </button>
                <div className="flex flex-col space-y-2 mt-2">
                  <input
                    type="text"
                    value={manualLocation}
                    onChange={(e) => setManualLocation(e.target.value)}
                    placeholder="Or enter location manually"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 transition-colors"
                  />
                  <button 
                    onClick={handleUpdateDetails}
                    disabled={!manualLocation.trim() || loading}
                    className="w-full py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-xl font-bold text-sm transition"
                  >
                    Submit Location
                  </button>
                </div>
              </div>
            ) : null}

            <hr className="border-slate-800" />

            {/* Mobile Number Section - High Priority */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">Contact Number <span className="text-red-500">*</span></h3>
              <div className="flex flex-col space-y-2">
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder="Enter your Mobile No. for callback"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 transition-colors shadow-inner"
                />
                <button 
                  onClick={handleUpdateDetails}
                  disabled={loading || !mobileNumber.trim()}
                  className="w-full py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-xl font-bold text-sm transition shadow-lg active:scale-95"
                >
                  Save Number
                </button>
              </div>
            </div>

            <hr className="border-slate-800" />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">Emergency Type</h3>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => {
                  const isSelected = liveAlert?.emergencyType === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => handleSelectType(t.value)}
                      disabled={loading}
                      className={`py-3 px-2 rounded-xl font-bold flex items-center justify-center space-x-2 transition ${
                        isSelected 
                          ? 'bg-red-600 text-white border-2 border-red-400 shadow-[0_0_15px_rgba(220,38,38,0.5)]' 
                          : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <span className="text-lg">{t.icon}</span>
                      <span className="text-sm">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <hr className="border-slate-800" />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">Reporting for someone else? (Optional)</h3>
              
              <label className="flex items-center space-x-3 cursor-pointer p-3 bg-slate-800 border border-slate-700 rounded-xl">
                <input 
                  type="checkbox" 
                  checked={isForOther}
                  onChange={(e) => setIsForOther(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-500 text-red-500 focus:ring-red-500 bg-slate-900"
                />
                <span className="text-sm font-bold text-slate-300">Yes, this emergency is for a family/friend</span>
              </label>

              {isForOther && (
                <div className="flex flex-col space-y-2">
                  <input
                    type="text"
                    value={manualLocation}
                    onChange={(e) => setManualLocation(e.target.value)}
                    placeholder="Provide location/landmark of family/friend"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 transition-colors"
                  />
                  
                  <button 
                    onClick={handleUpdateDetails}
                    disabled={loading}
                    className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-xl font-bold text-sm transition shadow-lg active:scale-95"
                  >
                    Submit Location Info
                  </button>
                </div>
              )}
            </div>
          </div>

          {!isCancelled && !isResolved && (
            <div className="mt-8 pt-6 border-t border-slate-800">
              {showCancelConfirm ? (
                <div className="bg-slate-800 border border-slate-700 p-4 rounded-xl text-center space-y-4">
                  <h4 className="text-white font-bold">Are you sure?</h4>
                  <p className="text-slate-400 text-xs">Authorities have already been notified. Cancel this emergency alert?</p>
                  <div className="flex space-x-3">
                    <button onClick={handleCancelAlert} disabled={loading} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-sm">Cancel Alert</button>
                    <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm">Keep Alert Active</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="w-full py-4 rounded-xl font-bold transition flex items-center justify-center bg-transparent text-slate-400 border border-slate-600 hover:bg-slate-800 hover:text-white hover:border-slate-500"
                >
                  <span className="text-lg mr-2">⚪</span> False Alarm
                </button>
              )}
              {isAcknowledged && (
                <p className="text-yellow-500/80 text-[10px] mt-3 text-center px-4">
                  ⚠️ Your emergency has already been acknowledged. Cancelling now will immediately notify the responding authority to stand down.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SOSDialog;
