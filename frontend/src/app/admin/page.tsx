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
  AlertCircle
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

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "Approved":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25";
      case "Rejected":
        return "bg-police-red/10 text-police-red-light border border-police-red/25";
      case "Under Review":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/25";
      case "Pending Verification":
        return "bg-blue-500/10 text-blue-400 border border-blue-500/25";
      default:
        return "bg-slate-700/20 text-slate-300 border border-slate-700/40";
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-1 flex flex-col justify-start w-full">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-6 mb-8 gap-4">
        <div>
          <span className="inline-block px-2.5 py-0.5 bg-police-navy-light text-police-gold border border-police-gold/25 text-[10px] font-bold rounded uppercase tracking-wider mb-2">
            UP Police Official Portal
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center space-x-2.5">
            <span>🛡️</span>
            <span>Admin Control Panel</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitor and audit all citizen assistance requests filed via the Rakku chatbot.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2.5 self-start md:self-center">
          <a
            href="/admin-intelligence"
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow-md transition-all flex items-center space-x-2 active:scale-95 cursor-pointer border border-amber-600/30"
          >
            <span>💡</span>
            <span>Intelligence & Feedback</span>
          </a>

          <button
            onClick={loadData}
            disabled={loading}
            className="btn-primary px-4 py-2 text-xs font-semibold rounded-lg shadow-md border flex items-center space-x-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>Refresh Records</span>
          </button>
        </div>
      </div>

      {/* EMERGENCY ALERTS WIDGET */}
      <EmergencyAlertsWidget />

      {/* Stats Board */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-panel rounded-xl p-5 text-center flex flex-col items-center">
          <div className="p-2 bg-police-red/10 rounded-lg mb-2">
            <FileText className="w-5 h-5 text-police-red-light" />
          </div>
          <p className="text-xl font-bold text-white">{complaints.length}</p>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Complaints Lodged</p>
        </div>
        <div className="glass-panel rounded-xl p-5 text-center flex flex-col items-center">
          <div className="p-2 bg-police-gold/10 rounded-lg mb-2">
            <ShieldCheck className="w-5 h-5 text-police-gold" />
          </div>
          <p className="text-xl font-bold text-white">{verifications.length}</p>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Verifications</p>
        </div>
        <div className="glass-panel rounded-xl p-5 text-center flex flex-col items-center">
          <div className="p-2 bg-blue-400/10 rounded-lg mb-2">
            <UserCheck className="w-5 h-5 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">{certificates.length}</p>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Certificates Filed</p>
        </div>
        <div className="glass-panel rounded-xl p-5 text-center flex flex-col items-center">
          <div className="p-2 bg-emerald-400/10 rounded-lg mb-2">
            <CalendarDays className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-xl font-bold text-white">{events.length}</p>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Event Permissions</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="glass-panel rounded-xl p-4 mb-6 border-slate-800/80 flex flex-col md:flex-row items-center gap-4">
        {/* Search Bar */}
        <div className="relative w-full md:flex-1">
          <input
            type="text"
            placeholder="Search by Reference Number, Name, Type, or details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700/80 focus:border-police-gold/80 rounded-lg text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
          />
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        </div>

        {/* Tab Buttons */}
        <div className="flex flex-wrap gap-1.5 w-full md:w-fit bg-slate-900/60 p-1 rounded-lg border border-slate-800">
          {(["complaints", "verifications", "certificates", "events"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setSearchQuery("");
              }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === tab 
                  ? "bg-slate-800 text-police-gold border-b border-police-gold/50 shadow-sm" 
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table Panel */}
      <div className="glass-card rounded-xl border-slate-800/80 overflow-hidden shadow-xl flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-police-gold" />
            <p className="text-xs">Fetching records from server database...</p>
          </div>
        ) : currentData.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
            <SlidersHorizontal className="w-8 h-8 text-slate-600" />
            <p className="text-sm font-semibold">No records found</p>
            <p className="text-[10px] text-slate-600">No submissions correspond to the selected criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                  <th className="p-4">Reference No</th>
                  <th className="p-4">Type / Name</th>
                  <th className="p-4">Details / Address</th>
                  <th className="p-4">Lodged Date</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Manage Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {currentData.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-900/10 transition-colors">
                    {/* Ref Number */}
                    <td className="p-4 font-mono font-bold text-police-gold tracking-wide">
                      {item.referenceNumber}
                    </td>

                    {/* Type / Name */}
                    <td className="p-4">
                      {activeTab === "complaints" && (
                        <div>
                          <p className="font-semibold text-white">{item.complaintType}</p>
                          <p className="text-[10px] text-slate-400">Citizen: <strong className="text-police-gold">{item.citizen?.fullName || 'N/A'}</strong></p>
                        </div>
                      )}
                      {activeTab === "verifications" && (
                        <div>
                          <p className="font-semibold text-white">Candidate: {item.name}</p>
                          <p className="text-[10px] text-slate-400">{item.verificationType} | Citizen: <strong className="text-police-gold">{item.citizen?.fullName || 'N/A'}</strong></p>
                        </div>
                      )}
                      {activeTab === "certificates" && (
                        <div>
                          <p className="font-semibold text-white">Applicant: {item.name}</p>
                          <p className="text-[10px] text-slate-400">District: {item.district} | Citizen: <strong className="text-police-gold">{item.citizen?.fullName || 'N/A'}</strong></p>
                        </div>
                      )}
                      {activeTab === "events" && (
                        <div>
                          <p className="font-semibold text-white">Event: {item.eventName}</p>
                          <p className="text-[10px] text-slate-400">{item.eventType} | Citizen: <strong className="text-police-gold">{item.citizen?.fullName || 'N/A'}</strong></p>
                        </div>
                      )}
                    </td>

                    {/* Details / Address */}
                    <td className="p-4 max-w-xs whitespace-pre-wrap">
                      {activeTab === "complaints" && (
                        <div>
                          <p className="text-slate-300 font-light truncate" title={item.incidentDetails}>{item.incidentDetails}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">Mob: {item.citizen?.mobileNumber || 'N/A'}</p>
                        </div>
                      )}
                      {activeTab === "verifications" && (
                        <div>
                          <p className="text-slate-300 font-light truncate" title={item.address}>Address: {item.address}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">Property: {item.propertyDetails}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Cand. Mob: {item.mobile} | Cit. Mob: {item.citizen?.mobileNumber || 'N/A'}</p>
                        </div>
                      )}
                      {activeTab === "certificates" && (
                        <div>
                          <p className="text-slate-300 font-light truncate" title={item.address}>Address: {item.address}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">Purpose: {item.purpose}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Cit. Mob: {item.citizen?.mobileNumber || 'N/A'}</p>
                        </div>
                      )}
                      {activeTab === "events" && (
                        <div>
                          <p className="text-slate-300 font-light truncate" title={item.location}>Location: {item.location}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">Date: {item.date} | Att: {item.expectedAttendance}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Cit. Mob: {item.citizen?.mobileNumber || 'N/A'}</p>
                        </div>
                      )}
                    </td>

                    {/* Lodged Date */}
                    <td className="p-4 text-slate-400 text-xs">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>

                    {/* Current Status */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded text-[10px] font-bold ${getStatusBadgeClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>

                    {/* Action Selector */}
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center">
                        {updatingId === item.referenceNumber ? (
                          <Loader2 className="w-4 h-4 animate-spin text-police-gold" />
                        ) : (
                          <select
                            value={item.status}
                            onChange={(e) => handleStatusChange(item.referenceNumber, e.target.value)}
                            className="bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-300 hover:text-white focus:outline-none focus:border-police-gold transition-colors cursor-pointer"
                          >
                            {statusOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
