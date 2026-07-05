import React from "react";
import { avatarImages } from "../../utils/avatarConfig";
import RakkuStatusBadge from "./RakkuStatusBadge";
import RakkuSpeechBubble from "./RakkuSpeechBubble";
import { useLanguage } from "@/context/LanguageContext";

interface RakkuFloatingAssistantProps {
  state: string;
  speechBubbleText: string;
  onOptionClick: (value: string) => void;
  showQuickActions?: boolean;
}

export default function RakkuFloatingAssistant({
  state,
  speechBubbleText,
  onOptionClick,
  showQuickActions = false,
}: RakkuFloatingAssistantProps) {
  const isEmergency = state === "EMERGENCY";
  const { translate } = useLanguage();

  const getAnimationClass = () => {
    switch (state) {
      case "IDLE":
        return "animate-rakku-float";
      case "THINKING":
        return "animate-rakku-pulse-soft";
      case "SUCCESS":
      case "COMPLETED":
        return "animate-rakku-scale-bounce";
      case "EMERGENCY":
        return "animate-pulse";
      default:
        return "";
    }
  };

  const avatarSrc = avatarImages[state] || avatarImages["IDLE"];

  return (
    <div className="w-full flex flex-col items-center md:items-start transition-all duration-300">
      {/* Desktop Layout: Side-by-Side | Mobile Layout: Stacked */}
      <div className="w-full flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-5">
        
        {/* Avatar Card Column */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div 
            className={`w-28 h-28 md:w-36 md:h-36 rounded-2xl bg-white border border-slate-200 p-2 flex items-center justify-center shadow-md transition-all duration-300 ${
              isEmergency ? "border-red-500 animate-rakku-emergency-glow" : "hover:border-police-gold/50"
            }`}
          >
            <img
              src={avatarSrc}
              alt={`Inspector Rakku - ${state}`}
              className={`w-full h-full object-contain object-top transition-transform duration-300 ${getAnimationClass()}`}
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/rakku_officer.png";
              }}
            />
          </div>
          {/* Status Badge below Avatar Card */}
          <div className="mt-2.5">
            <RakkuStatusBadge state={state} />
          </div>
        </div>

        {/* Speech Bubble & Quick Actions Column */}
        <div className="flex-1 w-full max-w-xl flex flex-col justify-start relative">
          <div className="relative">
            {/* Speech bubble pointing arrow tail */}
            {/* Desktop: arrow points left | Mobile: arrow points up */}
            <div className="hidden md:block absolute left-[-6px] top-6 w-3 h-3 bg-slate-900 border-l border-b border-slate-800 rotate-45 z-10"></div>
            <div className="md:hidden absolute top-[-6px] left-1/2 transform -translate-x-1/2 w-3 h-3 bg-slate-900 border-l border-t border-slate-800 rotate-45 z-10"></div>
            
            <RakkuSpeechBubble 
              text={speechBubbleText} 
              state={state} 
              onOptionClick={onOptionClick} 
            />
          </div>

          {/* Quick Actions List (Only displayed below the latest speech bubble if enabled) */}
          {showQuickActions && (
            <div className="grid grid-cols-2 gap-2 mt-4 max-w-md w-full">
              <button
                onClick={() => onOptionClick(translate("SERVICE_NEAREST_STATION") === "नजदीकी थाना खोजें" ? "📍 नजदीकी थाना खोजें" : "nearest police station")}
                className="py-2 px-3 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 hover:border-police-gold/50 rounded-xl transition-all flex items-center space-x-2 text-[11px] font-bold text-slate-300 group cursor-pointer"
              >
                <span>📍</span>
                <span className="truncate group-hover:text-police-gold transition-colors">{translate("SERVICE_NEAREST_STATION") ? translate("SERVICE_NEAREST_STATION") : "Find Station"}</span>
              </button>

              <button
                onClick={() => onOptionClick(translate("SERVICE_EMERGENCY") === "आपातकालीन सहायता" ? "🆘 आपातकालीन सहायता" : "Emergency Help")}
                className="py-2 px-3 bg-slate-900/60 hover:bg-slate-800 border border-slate-850 border-red-900/30 hover:border-red-500 rounded-xl transition-all flex items-center space-x-2 text-[11px] font-bold text-slate-300 group cursor-pointer"
              >
                <span className="animate-pulse">🆘</span>
                <span className="truncate group-hover:text-red-400 transition-colors">{translate("SERVICE_EMERGENCY") ? translate("SERVICE_EMERGENCY") : "Emergency Help"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
