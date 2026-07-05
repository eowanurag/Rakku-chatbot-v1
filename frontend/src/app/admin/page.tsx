"use client";

import React, { useState, useEffect } from "react";
import { 
  FileText, 
  ShieldCheck, 
  UserCheck, 
  CalendarDays, 
  Loader2, 
  Search, 
  RefreshCw,
  SlidersHorizontal,
  CheckCircle,
  Clock,
  AlertCircle,
  MapPin
} from "lucide-react";
import { 
  ComplaintService, 
  VerificationService, 
  CertificateService, 
  EventService 
} from "../../services/api";
import EmergencyAlertsWidget from "./EmergencyAlertsWidget";

type TabType = "complaints" | "verifications" | "certificates" | "events";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>("complaints");
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [complaints, setComplaints] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  // Load all data
  const loadData = async () => {
    setLoading(true);
    try {
      const [cData, vData, certData, eData] = await Promise.all([
        ComplaintService.getAll(),
        VerificationService.getAll(),
        CertificateService.getAll(),
        EventService.getAll()
      ]);
      
      setComplaints(cData || []);
      setVerifications(vData || []);
      setCertificates(certData || []);
      setEvents(eData || []);
    } catch (e) {
      console.error("Error fetching admin data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle status update
  const handleStatusChange = async (refNum: string, newStatus: string) => {
    setUpdatingId(refNum);
    try {
      if (activeTab === "complaints") {
        await ComplaintService.updateStatus(refNum, newStatus);
        setComplaints(prev => prev.map(item => item.referenceNumber === refNum ? { ...item, status: newStatus } : item));
      } else if (activeTab === "verifications") {
        await VerificationService.updateStatus(refNum, newStatus);
        setVerifications(prev => prev.map(item => item.referenceNumber === refNum ? { ...item, status: newStatus } : item));
      } else if (activeTab === "certificates") {
        await CertificateService.updateStatus(refNum, newStatus);
        setCertificates(prev => prev.map(item => item.referenceNumber === refNum ? { ...item, status: newStatus } : item));
      } else if (activeTab === "events") {
        await EventService.updateStatus(refNum, newStatus);
        setEvents(prev => prev.map(item => item.referenceNumber === refNum ? { ...item, status: newStatus } : item));
      }
    } catch (err) {
      alert("Failed to update status. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  const getFilteredData = () => {
    const q = searchQuery.toLowerCase().trim();
    if (activeTab === "complaints") {
      return complaints.filter(item => 
        item.referenceNumber.toLowerCase().includes(q) || 
        item.complaintType.toLowerCase().includes(q) || 
        item.incidentDetails.toLowerCase().includes(q)
      );
    }
    if (activeTab === "verifications") {
      return verifications.filter(item => 
        item.referenceNumber.toLowerCase().includes(q) || 
        item.name.toLowerCase().includes(q) || 
        item.verificationType.toLowerCase().includes(q)
      );
    }
    if (activeTab === "certificates") {
      return certificates.filter(item => 
        item.referenceNumber.toLowerCase().includes(q) || 
        item.name.toLowerCase().includes(q) || 
        item.district.toLowerCase().includes(q)
      );
    }
    return events.filter(item => 
      item.referenceNumber.toLowerCase().includes(q) || 
      item.eventName.toLowerCase().includes(q) || 
      item.eventType.toLowerCase().includes(q)
    );
  };

  const currentData = getFilteredData();

  const statusOptions = ["Submitted", "Under Review", "Pending Verification", "Approved", "Rejected"];

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [drawerTab, setDrawerTab] = useState<"details" | "location" | "timeline">("details");
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc -> close drawer
      if (e.key === "Escape" && selectedRecord) {
        setSelectedRecord(null);
      }
      // / -> focus search
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRecord]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "Approved": case "Resolved": return "bg-[#10B981]/20 text-[#10B981]";
      case "Rejected": case "Cancelled": return "bg-slate-700/50 text-slate-400";
      case "Under Review": return "bg-[#3B82F6]/20 text-[#3B82F6]";
      case "Pending Verification": case "Submitted": return "bg-[#F59E0B]/20 text-[#F59E0B]";
      default: return "bg-slate-700/20 text-slate-300";
    }
  };

  const getDotClass = (status: string) => {
    switch (status) {
      case "Approved": case "Resolved": return "bg-[#10B981]";
      case "Rejected": case "Cancelled": return "bg-slate-500";
      case "Under Review": return "bg-[#3B82F6]";
      case "Pending Verification": case "Submitted": return "bg-[#F59E0B]";
      default: return "bg-slate-400";
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "";
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0F172A] overflow-hidden text-slate-300 font-sans">
      {/* HEADER */}
      <header className="h-16 bg-[#1E293B] border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-30 shadow-md">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-police-navy rounded-full flex items-center justify-center border-2 border-police-gold">
            <span className="text-xl">🛡️</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide">Rakku Police Command Center</h1>
            <div className="flex items-center space-x-2">
              <p className="text-[10px] text-police-gold uppercase tracking-widest font-semibold">Uttar Pradesh Digital Police Platform</p>
              <span className="text-[8px] bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">
                Rakku V1 Demo
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-8">
          <div className="text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{currentTime ? formatDate(currentTime) : ''}</p>
            <p className="text-lg font-mono font-bold text-white">{currentTime ? currentTime.toLocaleTimeString('en-US', { hour12: false }) : ''}</p>
          </div>
          
          <div className="w-px h-10 bg-slate-700"></div>

          <div className="flex items-center space-x-6">
            {/* Notification Bell */}
            <div className="relative cursor-pointer group">
              <span className="text-xl">🔔</span>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#EF4444] rounded-full flex items-center justify-center text-[10px] text-white font-bold animate-bounce">3</div>
              <div className="absolute top-8 -left-20 w-64 bg-[#1E293B] border border-slate-700 shadow-xl rounded-lg p-3 hidden group-hover:block z-50">
                <p className="text-xs font-bold text-slate-300 mb-2 border-b border-slate-700 pb-1">Notifications (3)</p>
                <ul className="space-y-2 text-xs text-slate-400">
                  <li><span className="text-[#EF4444]">●</span> New SOS from Lucknow</li>
                  <li><span className="text-[#10B981]">●</span> Complaint CMP-1024 Approved</li>
                  <li><span className="text-[#3B82F6]">●</span> Verification VFC-202 Completed</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col items-end">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Platform Status</p>
              <div className="flex items-center space-x-2 mt-0.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] animate-pulse"></span>
                <span className="text-sm font-bold text-[#10B981]">Operational</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT SIDEBAR */}
        <aside className="w-64 bg-[#1E293B]/60 border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-4 space-y-1">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 px-3 mt-2">Modules</div>
            
            <button onClick={() => {setActiveTab("complaints"); setSearchQuery("");}} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'complaints' ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <FileText className="w-5 h-5" /> <span>Complaints</span>
            </button>
            <button onClick={() => {setActiveTab("verifications"); setSearchQuery("");}} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'verifications' ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <ShieldCheck className="w-5 h-5" /> <span>Verification</span>
            </button>
            <button onClick={() => {setActiveTab("certificates"); setSearchQuery("");}} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'certificates' ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <UserCheck className="w-5 h-5" /> <span>Certificates</span>
            </button>
            <button onClick={() => {setActiveTab("events"); setSearchQuery("");}} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'events' ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <CalendarDays className="w-5 h-5" /> <span>Events</span>
            </button>
          </div>
          
          <div className="mt-auto p-4">
            <button onClick={loadData} disabled={loading} className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-lg text-sm font-bold transition-all border border-slate-700">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>Sync Records</span>
            </button>
          </div>
        </aside>

        {/* MAIN WORKSPACE */}
        <main className="flex-1 flex flex-col overflow-y-auto p-6 bg-[#0F172A] relative">
          
          {/* Analytics Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#3B82F6]/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-[#3B82F6]/10 transition-colors"></div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Total Complaints</p>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-extrabold text-white">{complaints.length}</p>
                <div className="flex items-center space-x-1 text-[#10B981] text-xs font-bold bg-[#10B981]/10 px-2 py-1 rounded">
                  <span>↑</span><span>12%</span>
                </div>
              </div>
            </div>
            
            <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-amber-500/10 transition-colors"></div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Pending Verifications</p>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-extrabold text-white">{verifications.filter(v => v.status === 'Submitted' || v.status === 'Pending Verification').length}</p>
                <div className="flex items-center space-x-1 text-amber-500 text-xs font-bold bg-amber-500/10 px-2 py-1 rounded">
                  <span>↓</span><span>4%</span>
                </div>
              </div>
            </div>

            <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-police-gold/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-police-gold/10 transition-colors"></div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Certificates Issued</p>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-extrabold text-white">{certificates.filter(c => c.status === 'Approved').length}</p>
                <div className="w-16 h-6 border-b-2 border-police-gold/50 rounded-[50%]"></div>
              </div>
            </div>

            <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-colors"></div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Upcoming Events</p>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-extrabold text-white">{events.filter(e => e.status === 'Approved').length}</p>
                <div className="w-16 h-6 border-b-2 border-emerald-500/50 rounded-[50%]"></div>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex items-center justify-between mb-4">
            <div className="relative w-96">
              <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                id="global-search"
                type="text"
                placeholder="Search reference, citizen, or location... (Press /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-[#1E293B] border border-slate-700/80 focus:border-[#3B82F6] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition-colors shadow-inner"
              />
            </div>
            <h2 className="text-lg font-bold text-white uppercase tracking-widest">{activeTab} List</h2>
          </div>

          {/* Minimal Table */}
          <div className="bg-[#1E293B] border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex-1 flex flex-col">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#3B82F6]" />
                <p className="text-sm font-semibold">Syncing Data...</p>
              </div>
            ) : currentData.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
                <SlidersHorizontal className="w-8 h-8 opacity-50 mb-2" />
                <p className="text-base font-bold text-slate-400">No Records Found</p>
                <p className="text-xs">No entries match your current search filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto w-full flex-1">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/50 text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                      <th className="p-4 w-40">Ref ID</th>
                      <th className="p-4">Citizen</th>
                      <th className="p-4">Type / Classification</th>
                      <th className="p-4 w-40">Lodged</th>
                      <th className="p-4 w-40">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {currentData.map((item) => (
                      <tr 
                        key={item.id} 
                        onClick={() => setSelectedRecord(item)}
                        className="hover:bg-slate-800/50 transition-colors cursor-pointer group relative"
                      >
                        {updatingId === item.referenceNumber && (
                          <div className="absolute inset-0 bg-[#3B82F6]/10 animate-pulse pointer-events-none"></div>
                        )}
                        <td className="p-4 font-mono font-bold text-police-gold text-xs relative z-10">
                          {item.referenceNumber}
                        </td>
                        <td className="p-4 relative z-10">
                          <p className="font-bold text-slate-200 group-hover:text-[#3B82F6] transition-colors">{item.citizen?.fullName || item.name || 'Anonymous'}</p>
                          <p className="text-[10px] font-mono text-slate-500 mt-0.5">{item.citizen?.mobileNumber || item.mobile || 'No Mobile'}</p>
                        </td>
                        <td className="p-4 relative z-10">
                          <p className="text-slate-300 font-medium text-xs">{item.complaintType || item.verificationType || item.purpose || item.eventType}</p>
                        </td>
                        <td className="p-4 text-slate-400 text-xs font-mono relative z-10">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 relative z-10">
                          <div className={`inline-flex items-center space-x-2 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-transparent ${getStatusBadgeClass(item.status)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${getDotClass(item.status)}`}></span>
                            <span>{item.status}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
          {/* Footer Sync Status */}
          <div className="mt-4 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest border-t border-slate-800 pt-3">
             <div className="flex space-x-6">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10B981] rounded-full"></span> Backend Online</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10B981] rounded-full"></span> AI Connected</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10B981] rounded-full"></span> DB Connected</span>
             </div>
             <span>Last Sync: {currentTime?.toLocaleTimeString()}</span>
          </div>
        </main>

        {/* RIGHT EMERGENCY FEED */}
        <aside className="w-[400px] bg-[#1E293B] border-l border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl relative">
          <EmergencyAlertsWidget />
        </aside>

        {/* SLIDING DRAWER OVERLAY */}
        {selectedRecord && (
          <div className="absolute inset-0 z-50 flex justify-end overflow-hidden">
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
              onClick={() => setSelectedRecord(null)}
            ></div>
            
            <div className="w-[500px] bg-[#0F172A] h-full shadow-2xl border-l border-slate-700 relative flex flex-col animate-in slide-in-from-right-8 duration-300">
              
              {/* Drawer Header */}
              <div className="p-6 border-b border-slate-800 bg-[#1E293B]">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-[10px] font-bold text-police-gold uppercase tracking-widest bg-police-gold/10 px-2 py-1 rounded">
                        {activeTab.slice(0, -1)} Record
                      </span>
                      <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getStatusBadgeClass(selectedRecord.status)}`}>
                        <span className={`w-1 h-1 rounded-full ${getDotClass(selectedRecord.status)}`}></span>
                        <span>{selectedRecord.status}</span>
                      </span>
                    </div>
                    <h2 className="text-xl font-extrabold text-white mt-1 font-mono">{selectedRecord.referenceNumber}</h2>
                    <p className="text-xs text-slate-400 font-mono mt-1">Submitted on {new Date(selectedRecord.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <button onClick={() => setSelectedRecord(null)} className="p-2 hover:bg-slate-700 text-slate-400 hover:text-white rounded-full transition-colors group relative">
                    ✕
                    <span className="absolute -bottom-6 right-0 bg-black/80 text-[10px] text-white px-2 py-1 rounded hidden group-hover:block whitespace-nowrap">Esc</span>
                  </button>
                </div>
                
                <div className="flex space-x-6 border-b border-slate-700 mt-6">
                  <button 
                    onClick={() => setDrawerTab("details")}
                    className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors ${drawerTab === 'details' ? 'text-[#3B82F6] border-b-2 border-[#3B82F6]' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    Details
                  </button>
                  <button 
                    onClick={() => setDrawerTab("location")}
                    className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors ${drawerTab === 'location' ? 'text-[#3B82F6] border-b-2 border-[#3B82F6]' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    Location
                  </button>
                  <button 
                    onClick={() => setDrawerTab("timeline")}
                    className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors ${drawerTab === 'timeline' ? 'text-[#3B82F6] border-b-2 border-[#3B82F6]' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    Timeline
                  </button>
                </div>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-[#0F172A]">
                
                {drawerTab === 'details' && (
                  <div className="space-y-6 animate-in fade-in">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Citizen Profile</h4>
                      <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-4 flex flex-col space-y-2">
                        <p className="text-sm text-slate-300"><strong className="text-white">Name:</strong> {selectedRecord.citizen?.fullName || selectedRecord.name || 'Anonymous'}</p>
                        <p className="text-sm text-slate-300"><strong className="text-white">Mobile:</strong> {selectedRecord.citizen?.mobileNumber || selectedRecord.mobile || 'N/A'}</p>
                        <p className="text-sm text-slate-300"><strong className="text-white">Address:</strong> {selectedRecord.citizen?.addressLine1 || 'N/A'}</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Submission Data</h4>
                      <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-4 space-y-3">
                        <p className="text-sm text-slate-300"><strong className="text-white">Type:</strong> {selectedRecord.complaintType || selectedRecord.verificationType || selectedRecord.eventType || selectedRecord.purpose}</p>
                        
                        {(selectedRecord.incidentDetails || selectedRecord.propertyDetails) && (
                          <div>
                            <strong className="text-white text-sm">Description:</strong>
                            <p className="text-sm text-slate-400 mt-1 bg-slate-900 p-3 rounded-lg border border-slate-800 whitespace-pre-wrap">
                              {selectedRecord.incidentDetails || selectedRecord.propertyDetails}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {drawerTab === 'location' && (
                  <div className="space-y-6 animate-in fade-in">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Location Data</h4>
                    <div className="bg-[#1E293B] border border-slate-800 rounded-xl p-4">
                      <p className="text-sm text-slate-300 mb-4 font-mono">{selectedRecord.address || selectedRecord.location || selectedRecord.district || 'Location details not provided.'}</p>
                      
                      {/* Map Placeholder */}
                      <div className="w-full h-48 bg-slate-900 border border-slate-700 rounded-lg flex flex-col items-center justify-center relative overflow-hidden group">
                        <div className="absolute inset-0 bg-slate-800/20 z-0 pattern-grid opacity-20"></div>
                        <MapPin className="w-8 h-8 text-police-gold mb-2 z-10" />
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest z-10">[ Future Live Map ]</p>
                      </div>
                    </div>
                  </div>
                )}

                {drawerTab === 'timeline' && (
                  <div className="space-y-6 animate-in fade-in">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Audit Log</h4>
                    <div className="relative pl-4 border-l-2 border-slate-800 space-y-6 ml-2">
                      <div className="relative">
                        <div className="absolute w-3 h-3 bg-[#10B981] rounded-full -left-[23px] top-1"></div>
                        <p className="text-xs text-slate-500 font-mono mb-1">{new Date(selectedRecord.createdAt).toLocaleString()}</p>
                        <p className="text-sm font-bold text-white">Record Submitted</p>
                        <p className="text-xs text-slate-400 mt-0.5">Automated ingestion via Rakku Chatbot.</p>
                      </div>
                      
                      <div className="relative">
                        <div className="absolute w-3 h-3 bg-[#3B82F6] rounded-full -left-[23px] top-1 animate-pulse"></div>
                        <p className="text-xs text-slate-500 font-mono mb-1">Current Status</p>
                        <p className="text-sm font-bold text-white">Moved to {selectedRecord.status}</p>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Drawer Footer / Actions */}
              <div className="p-6 border-t border-slate-800 bg-[#1E293B]">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Status Management</h4>
                <div className="grid grid-cols-2 gap-3">
                  {statusOptions.map(opt => (
                    <button
                      key={opt}
                      disabled={updatingId === selectedRecord.referenceNumber || selectedRecord.status === opt}
                      onClick={async () => {
                        await handleStatusChange(selectedRecord.referenceNumber, opt);
                        setSelectedRecord((prev: any) => ({ ...prev, status: opt }));
                      }}
                      className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${
                        selectedRecord.status === opt 
                          ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/50 cursor-default' 
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      {updatingId === selectedRecord.referenceNumber && selectedRecord.status !== opt ? 'Updating...' : `Mark ${opt}`}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
