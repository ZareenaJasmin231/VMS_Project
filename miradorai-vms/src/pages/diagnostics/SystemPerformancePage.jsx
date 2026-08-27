import React, { useState } from "react";
import ProcessMetricsPanel from "../../components/dashboard/ProcessMetricsPanel";
import ProcessHistoryPanel from "../../components/dashboard/ProcessHistoryPanel";
import HardwareScalingReportModal from "../../components/dashboard/HardwareScalingReportModal";
import LiveStreamingReportModal from "../../components/dashboard/LiveStreamingReportModal";
import "./SystemPerformancePage.css";

const SystemPerformancePage = () => {
  const [activeTab, setActiveTab] = useState("live"); // 'live' | 'history'
  const [isScalingModalOpen, setIsScalingModalOpen] = useState(false);
  const [isLiveStreamingModalOpen, setIsLiveStreamingModalOpen] = useState(false);

  return (
    <div className="sys-perf-page">
      <div className="sys-perf-page-header">
        <div className="sys-perf-header-flex">
          <h2 className="sys-perf-title">System Performance & Process Inspector</h2>
          
          <div className="sys-perf-tab-group">
            <button 
              className={`sys-perf-tab-btn ${activeTab === 'live' ? 'active' : ''}`}
              onClick={() => setActiveTab('live')}
            >
              Live Inspector
            </button>
            <button 
              className={`sys-perf-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Uptime & Downtime History
            </button>
          </div>
        </div>
      </div>

      <div className="sys-perf-content">
        {activeTab === 'live' ? (
          <ProcessMetricsPanel 
            onOpenScalingReport={() => setIsScalingModalOpen(true)} 
            onOpenLiveStreamingReport={() => setIsLiveStreamingModalOpen(true)}
          />
        ) : (
          <ProcessHistoryPanel />
        )}

        <HardwareScalingReportModal 
          isOpen={isScalingModalOpen} 
          onClose={() => setIsScalingModalOpen(false)} 
        />

        <LiveStreamingReportModal 
          isOpen={isLiveStreamingModalOpen} 
          onClose={() => setIsLiveStreamingModalOpen(false)} 
        />
      </div>
    </div>
  );
};

export default SystemPerformancePage;
