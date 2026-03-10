import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  Camera as CameraIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cpu,
  Fingerprint,
  Home,
  Info,
  Loader2,
  Minus,
  MonitorOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Video,
  Zap,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Save
} from "lucide-react";
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import ReactPlayer from "react-player";

interface AppDeviceInfo {
  name: string | null;
  url: string[];
  address: string;
  stable_id: string | null;
}

interface AppProfile {
  token: string;
  name: string;
}

interface AppDeviceInformation {
  manufacturer: string;
  model: string;
  firmware_version: string;
  serial_number: string;
  hardware_id: string;
}

interface AppDeviceServices {
  media: string | null;
  ptz: string | null;
  device_mgmt: string;
}

interface AppVideoEncoderConfiguration {
  token: string;
  encoding: string;
  width: number;
  height: number;
  quality: number;
  fps: number;
  gov_length: number;
  bitrate_limit: number;
  min_quality: number;
  max_quality: number;
  min_fps: number;
  max_fps: number;
}

interface AppPtzPosition {
  x: number;
  y: number;
  zoom: number;
  pan_tilt_space?: string;
  zoom_space?: string;
}

interface AppPtzPreset {
  token: string;
  name: string | null;
}

function App() {
  const [cameras, setCameras] = useState<AppDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState<AppDeviceInfo | null>(null);
  const [services, setServices] = useState<AppDeviceServices | null>(null);
  const [profiles, setProfiles] = useState<AppProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [info, setInfo] = useState<AppDeviceInformation | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [streamUri, setStreamUri] = useState<string>("");
  const [snapshotUri, setSnapshotUri] = useState<string>("");
  const [muted, setMuted] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [videoConfig, setVideoConfig] = useState<AppVideoEncoderConfiguration | null>(null);
  const [osdText, setOsdText] = useState("");
  const [isExternalOpen, setIsExternalOpen] = useState(false);
  const [showPanels, setShowPanels] = useState(true);
  const [ptzStatus, setPtzStatus] = useState<AppPtzPosition | null>(null);
  const [onvifPresets, setOnvifPresets] = useState<AppPtzPreset[]>([]);

  useEffect(() => {
    const unlisten = listen("mpv-closed", () => {
      setIsExternalOpen(false);
      setStatus("External player closed");
    });
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const discover = async () => {
    setLoading(true);
    setStatus("Discovering cameras...");
    try {
      const cams = await invoke<AppDeviceInfo[]>("discover_cameras");
      setCameras(cams);
      setStatus(`Found ${cams.length} cameras`);
    } catch (e) {
      setStatus(`Discovery failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthError = (err: any, retryAction: () => Promise<void>) => {
    const errStr = String(err);
    if (errStr.includes("Unauthorized") || errStr.includes("401") || errStr.includes("403")) {
      setPendingAction(() => retryAction);
      setAuthModalOpen(true);
      setStatus("Authentication required");
    } else {
      setStatus(`Error: ${err}`);
    }
  };

  const submitAuth = async () => {
    try {
      await invoke("set_credentials", { username, password });
      setAuthModalOpen(false);
      if (pendingAction) {
        await pendingAction();
        setPendingAction(null);
      }
    } catch (e) {
      setStatus(`Auth failed: ${e}`);
    }
  };

  const selectCamera = async (cam: AppDeviceInfo) => {
    setSelectedCam(cam);
    setServices(null);
    setProfiles([]);
    setSelectedProfile("");
    setInfo(null);
    setStreamUri("");
    setSnapshotUri("");
    setStatus(`Connecting to ${cam.name || cam.address}...`);

    const run = async () => {
      try {
        const mgmtUrl = cam.url[0];
        const svcs = await invoke<AppDeviceServices>("fetch_services", { deviceMgmtUrl: mgmtUrl });
        setServices(svcs);

        const devInfo = await invoke<AppDeviceInformation>("fetch_device_info", { url: mgmtUrl });
        setInfo(devInfo);

        if (svcs.media) {
          const profs = await invoke<AppProfile[]>("fetch_profiles", { deviceMediaUrl: svcs.media });
          setProfiles(profs);
          if (profs.length > 0) {
            const token = profs[0].token;
            setSelectedProfile(token);
            await getStreamUri(svcs.media, token);
            await getSnapshotUri(svcs.media, token);
            await fetchVideoConfig(svcs.media, token);
            
            // Fetch PTZ data if available
            if (svcs.ptz) {
              await fetchPtzStatus(svcs.ptz, token);
              await fetchOnvifPresets(svcs.ptz, token);
            }
          }
        }
        setStatus("Connected");
      } catch (e) {
        handleAuthError(e, run);
      }
    };

    await run();
  };

  const getStreamUri = async (mediaUrl: string, token: string) => {
    const protocols = ["Http", "Rtsp", "Tcp", "Udp"];
    let finalUri = "";
    
    // Try each protocol
    for (const protocol of protocols) {
      try {
        const uri = await invoke<string>("fetch_stream_uri", { 
          deviceMediaUrl: mediaUrl, 
          profileToken: token,
          protocol: protocol
        });
        
        if (uri) {
          finalUri = uri;
          // If we find an HTTP based stream, it's most likely to work in a browser
          if (uri.toLowerCase().startsWith("http://") || uri.toLowerCase().startsWith("https://")) {
            setStreamUri(uri);
            return;
          }
        }
      } catch (e) {
        // Skip requested protocol
      }
    }
    
    // If no HTTP stream was found, set the last valid URI we got (likely RTSP)
    if (finalUri) {
      setStreamUri(finalUri);
    }
  };

  const isStreamWebCompatible = (uri: string) => {
    if (!uri) return false;
    const l = uri.toLowerCase();
    // Native RTSP usually fails in webviews
    if (l.startsWith("rtsp://")) return false;
    // HTTP/HTTPS streams like MJPEG, HLS (.m3u8), DASH (.mpd) work
    return l.startsWith("http://") || l.startsWith("https://");
  };

  const getSnapshotUri = async (mediaUrl: string, token: string) => {
    try {
      const uri = await invoke<string>("fetch_snapshot_uri", { deviceMediaUrl: mediaUrl, profileToken: token });
      const proxied = await invoke<string>("proxy_snapshot", { url: uri });
      setSnapshotUri(proxied);
    } catch (e) {
      console.warn("Failed to get snapshot URI:", e);
    }
  };

  const fetchVideoConfig = async (mediaUrl: string, profileToken: string) => {
    try {
      const config = await invoke<AppVideoEncoderConfiguration>("fetch_video_encoder_config", {
        deviceMediaUrl: mediaUrl,
        profileToken: profileToken
      });
      setVideoConfig(config);
    } catch (e) {
      console.warn("Failed to fetch video config:", e);
    }
  };

  const updateVideoSettings = async () => {
    if (!services?.media || !selectedProfile || !videoConfig) return;
    const mediaUrl = services.media;
    const profile = selectedProfile;
    setLoading(true);
    setStatus("Updating video settings...");
    const run = async () => {
      try {
        await invoke("update_video_encoder_config", {
          deviceMediaUrl: mediaUrl,
          profileToken: profile,
          newConfig: videoConfig
        });
        setStatus("Video settings updated");
        await fetchVideoConfig(mediaUrl, profile);
      } catch (e) {
        handleAuthError(e, run);
      } finally {
        setLoading(false);
      }
    };
    await run();
  };

  const updateOsd = async () => {
    if (!services?.media || !selectedProfile) return;
    const mediaUrl = services.media;
    const profile = selectedProfile;
    setLoading(true);
    setStatus("Updating OSD...");
    const run = async () => {
      try {
        await invoke("set_osd_text", {
          deviceMediaUrl: mediaUrl,
          profileToken: profile,
          text: osdText
        });
        setStatus("OSD updated");
      } catch (e) {
        handleAuthError(e, run);
      } finally {
        setLoading(false);
      }
    };
    await run();
  };

  const ptzMove = async (pan: number, tilt: number, zoom: number) => {
    if (!services?.ptz || !selectedProfile) return;
    const run = async () => {
      try {
        await invoke("ptz_continuous_move", {
          devicePtzUrl: services.ptz,
          profileToken: selectedProfile,
          pan,
          tilt,
          zoom
        });
        // Update telemetry after a short delay
        setTimeout(fetchPtzStatus, 500);
      } catch (e) {
        handleAuthError(e, run);
      }
    };
    await run();
  };

  const fetchPtzStatus = async (overridePtzUrl?: string, overrideProfile?: string) => {
    const ptzUrl = overridePtzUrl || services?.ptz;
    const profile = overrideProfile || selectedProfile;
    if (!ptzUrl || !profile) return;
    
    try {
      const pos = await invoke<AppPtzPosition>("ptz_get_status", {
        devicePtzUrl: ptzUrl,
        profileToken: profile
      });
      setPtzStatus(pos);
    } catch (e) {
      console.warn("Failed to fetch PTZ status:", e);
    }
  };

  const ptzStop = async () => {
    if (!services?.ptz || !selectedProfile) return;
    try {
      await invoke("ptz_stop", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile
      });
    } catch (e) {
      setStatus(`Stop failed: ${e}`);
    }
  };

  const ptzHome = async () => {
    if (onvifPresets.length === 0) {
      setStatus("No hardware presets available");
      return;
    }
    
    // Try to find a preset named "Home" or "Default"
    const homePreset = onvifPresets.find(p => {
      const name = (p.name || "").toLowerCase();
      return name === "home" || name === "default";
    }) || onvifPresets[0];

    await gotoOnvifPreset(homePreset.name || `Preset ${homePreset.token}`, homePreset.token);
  };

  const fetchOnvifPresets = async (overridePtzUrl?: string, overrideProfile?: string) => {
    const ptzUrl = overridePtzUrl || services?.ptz;
    const profile = overrideProfile || selectedProfile;
    if (!ptzUrl || !profile) return;
    
    try {
      const resp = await invoke<AppPtzPreset[]>("ptz_get_presets", {
        devicePtzUrl: ptzUrl,
        profileToken: profile
      });
      // Filter out presets with empty tokens
      setOnvifPresets(resp.filter(p => p.token && p.token.trim() !== ""));
    } catch (e) {
      console.warn("Failed to fetch ONVIF presets:", e);
    }
  };

  const saveOnvifPreset = async (manualName?: string) => {
    if (!services?.ptz || !selectedProfile) return;
    
    setLoading(true);
    setStatus("Syncing hardware list...");
    try {
      // Get latest to check limits (255 is usually max)
      const resp = await invoke<AppPtzPreset[]>("ptz_get_presets", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile
      });
      
      const current = resp.filter(p => p.token && p.token.trim() !== "");
      
      if (current.length >= 255) {
        setStatus("Error: Camera hardware preset limit reached (255)");
        return;
      }

      const name = manualName || prompt("Preset Name:");
      if (!name) return;
      
      setStatus(`Setting hardware preset "${name}"...`);
      await invoke("ptz_set_preset", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile,
        presetName: name
      });
      setStatus(`Hardware preset "${name}" set`);
      await fetchOnvifPresets();
    } catch (e) {
      setStatus(`Failed to set preset: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const updateOnvifPreset = async (name: string, token: string) => {
    if (!services?.ptz || !selectedProfile) return;
    setLoading(true);
    setStatus(`Updating hardware preset "${name}"...`);
    try {
      await invoke("ptz_set_preset", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile,
        presetName: name,
        presetToken: token
      });
      setStatus(`Hardware preset "${name}" updated`);
      await fetchOnvifPresets();
    } catch (e) {
      setStatus(`Failed to update: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const gotoOnvifPreset = async (name: string, token: string) => {
    if (!services?.ptz || !selectedProfile) return;
    setLoading(true);
    setStatus(`Moving to hardware preset "${name}"...`);
    try {
      await invoke("ptz_goto_preset", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile,
        presetToken: token
      });
      setStatus(`Moved to "${name}"`);
      setTimeout(fetchPtzStatus, 1000);
    } catch (e) {
      setStatus(`Failed to move: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteOnvifPreset = async (name: string, token: string) => {
    if (!services?.ptz || !selectedProfile) return;
    if (!confirm(`Delete preset "${name}" from camera hardware?`)) return;
    
    setLoading(true);
    setStatus(`Deleting hardware preset "${name}"...`);
    try {
      await invoke("ptz_remove_preset", {
        devicePtzUrl: services.ptz,
        profileToken: selectedProfile,
        presetToken: token
      });
      setStatus(`Preset "${name}" removed`);
      await fetchOnvifPresets();
    } catch (e) {
      setStatus(`Failed to remove: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const disableOsd = async () => {
    if (!services?.media || !selectedProfile) return;
    const mediaUrl = services.media;
    const profile = selectedProfile;
    setLoading(true);
    setStatus("Disabling OSD...");
    const run = async () => {
      try {
        await invoke("disable_osd", {
          deviceMediaUrl: mediaUrl,
          profileToken: profile
        });
        setStatus("OSD elements removed");
      } catch (e) {
        handleAuthError(e, run);
      } finally {
        setLoading(false);
      }
    };
    await run();
  };

  const syncIFrame = async () => {
    if (!services?.media || !selectedProfile) return;
    const mediaUrl = services.media;
    const profile = selectedProfile;
    setLoading(true);
    setStatus("Syncing I-Frame...");
    const run = async () => {
      try {
        await invoke("adjust_stream_settings", {
          deviceMediaUrl: mediaUrl,
          profileToken: profile
        });
        setStatus("I-Frame sync complete");
        await fetchVideoConfig(mediaUrl, profile);
      } catch (e) {
        handleAuthError(e, run);
      } finally {
        setLoading(false);
      }
    };
    await run();
  };

  const optimizeStream = async () => {
    if (!services?.media || !selectedProfile) return;
    const run = async () => {
      setLoading(true);
      setStatus("Optimizing stream...");
      try {
        await invoke("disable_osd", {
          deviceMediaUrl: services.media,
          profileToken: selectedProfile
        });
        await invoke("adjust_stream_settings", {
          deviceMediaUrl: services.media,
          profileToken: selectedProfile
        });
        setStatus("Stream optimized: OSD off, GovLength synced");
      } catch (e) {
        handleAuthError(e, run);
      } finally {
        setLoading(false);
      }
    };
    await run();
  };

  const renderPtzControls = (overlay = false) => (
    <section className={`card glass ptz-card ${overlay ? 'ptz-overlay' : ''}`}>
      <h3><Zap size={18} /> PTZ Controls</h3>
      <div className="ptz-container">
        <div style={{ position: 'absolute', top: '-25px', right: 0, fontSize: '0.75rem', opacity: 0.6, display: 'flex', gap: '10px' }}>
          {ptzStatus && (
            <span>X:{ptzStatus.x.toFixed(2)} Y:{ptzStatus.y.toFixed(2)} Z:{ptzStatus.zoom.toFixed(2)}</span>
          )}
          <RefreshCw size={12} style={{ cursor: 'pointer' }} onClick={() => fetchPtzStatus()} />
        </div>
        <div className="dpad">
          <button className="ptz-btn up" onMouseDown={() => ptzMove(0, 1, 0)} onMouseUp={ptzStop}><ChevronUp /></button>
          <button className="ptz-btn left" onMouseDown={() => ptzMove(-1, 0, 0)} onMouseUp={ptzStop}><ChevronLeft /></button>
          <button className="ptz-btn right" onMouseDown={() => ptzMove(1, 0, 0)} onMouseUp={ptzStop}><ChevronRight /></button>
          <button className="ptz-btn down" onMouseDown={() => ptzMove(0, -1, 0)} onMouseUp={ptzStop}><ChevronDown /></button>
          <button className="ptz-btn home" onClick={ptzHome} title="Return to Home Position">
            <Home size={16} />
          </button>
        </div>
        <div className="ptz-actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="zoom-controls">
            <button className="ptz-btn zoom-in" onMouseDown={() => ptzMove(0, 0, 1)} onMouseUp={ptzStop}><Plus /> Zoom</button>
            <button className="ptz-btn zoom-out" onMouseDown={() => ptzMove(0, 0, -1)} onMouseUp={ptzStop}><Minus /> Zoom</button>
          </div>
          <button className="glass-btn sm" onClick={() => saveOnvifPreset("Default")} title="Set Current Position as Default">
            <Fingerprint size={14} /> Set Default
          </button>
        </div>
      </div>

      <div className="presets-section">
        <div className="presets-header">
          <h4>Camera Hard Presets</h4>
          <button className="glass-btn xs" onClick={() => saveOnvifPreset()}>
            <Plus size={12} /> New
          </button>
        </div>
        <div className="presets-list scrollable">
          {onvifPresets
            .sort((a, b) => {
              const nameA = a.name || `Preset ${a.token}`;
              const nameB = b.name || `Preset ${b.token}`;
              return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            })
            .map((p) => (
            <div key={p.token} className="preset-item glass">
              <span onClick={() => gotoOnvifPreset(p.name || `Preset ${p.token}`, p.token)} className="preset-name">
                {p.name || `Preset ${p.token}`}
              </span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button 
                  className="update-preset-btn"
                  onClick={() => updateOnvifPreset(p.name || `Preset ${p.token}`, p.token)} 
                  title="Update this preset with current position"
                >
                  <Save size={12} />
                </button>
                <button 
                  className="delete-preset-btn"
                  onClick={() => deleteOnvifPreset(p.name || p.token, p.token)} 
                  title="Delete preset from hardware"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {onvifPresets.length === 0 && (
            <span className="no-presets">No hardware presets found</span>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="app-container">
      {selectedCam && (
        <button 
          className="panel-toggle-btn" 
          onClick={() => setShowPanels(!showPanels)}
          title={showPanels ? "Hide Controls" : "Show Controls"}
        >
          {showPanels ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
        </button>
      )}

      {/* Sidebar */}
      <aside className={`sidebar glass ${!showPanels ? 'hidden' : ''}`}>
        <div className="sidebar-header">
          <CameraIcon size={24} className="icon-purple" />
          <h2>ONVIF Debugger</h2>
        </div>

        <button className="glow-btn discover-btn" onClick={discover} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
          <span>Discover</span>
        </button>

        <div className="camera-list">
          {cameras.map((cam, idx) => (
            <div
              key={cam.stable_id || cam.address || idx}
              className={`camera-item ${selectedCam?.stable_id === cam.stable_id ? 'active' : ''}`}
              onClick={() => selectCamera(cam)}
            >
              <div className="cam-icon">
                <Video size={16} />
              </div>
              <div className="cam-details">
                <span className="cam-name">{cam.name || "Unknown Device"}</span>
                <span className="cam-mac">{cam.stable_id || cam.address}</span>
              </div>
            </div>
          ))}
          {cameras.length === 0 && !loading && (
            <div className="empty-state">No cameras found</div>
          )}
        </div>

        <div className="status-bar">
          <Info size={14} />
          <span>{status || "Idle"}</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`main-content ${!showPanels ? 'minimal' : ''}`}>
        {selectedCam ? (
          <div className="dashboard">
            <header className="dashboard-header">
              <div className="header-info">
                <h1>{selectedCam.name || "ONVIF Camera"}</h1>
                <div className="identifiers">
                  <span className="tag"><Fingerprint size={12} /> {selectedCam.stable_id || "No ID"}</span>
                  <span className="tag"><Box size={12} /> {selectedCam.address}</span>
                </div>
              </div>
              <div className="header-actions">
                <button 
                  className={`glass-btn sm ${showPanels ? 'active' : ''}`}
                  onClick={() => setShowPanels(!showPanels)}
                  style={{ color: showPanels ? 'var(--accent)' : 'inherit' }}
                >
                  {showPanels ? <EyeOff size={16} /> : <Eye size={16} />} 
                  <span>{showPanels ? "Hide UI" : "Show UI"}</span>
                </button>
                <button className="accent-btn" onClick={optimizeStream} disabled={loading}>
                  <Zap size={18} /> Optimize Stream
                </button>
              </div>
            </header>

            <section className="card glass preview-card">
              <div className="preview-header">
                <h3><Video size={18} /> Stream Preview</h3>
                <div className="preview-actions">
                  <div className="toggle-group glass">
                    <label>No Audio</label>
                    <input
                      type="checkbox"
                      checked={muted}
                      onChange={(e) => setMuted(e.target.checked)}
                    />
                  </div>
                  <button className="glass-btn sm" onClick={() => {
                    if (streamUri) {
                      setIsExternalOpen(true);
                      invoke("open_in_mpv", { url: streamUri, noAudio: muted });
                    }
                  }} title="Open in mpv (Low Latency)">
                    <MonitorOff size={14} /> <span>Open External</span>
                  </button>
                  <button className="glass-btn sm" onClick={() => {
                    if (services?.media && selectedProfile) getSnapshotUri(services.media, selectedProfile);
                  }} title="Refresh Snapshot">
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              <div className="player-wrapper glass">
                {isExternalOpen ? (
                  <div className="remote-placeholder">
                    <MonitorOff size={48} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <h3 style={{ margin: 0 }}>Streaming to External Player</h3>
                      <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>Controls Active & Linked</p>
                      <div style={{ marginTop: '10px' }}>
                        <span>Active Remote Mode</span>
                      </div>
                    </div>
                  </div>
                ) : streamUri && isStreamWebCompatible(streamUri) ? (
                  <div className="player-container">
                    {(() => {
                      const Player = ReactPlayer as any;
                      return <Player
                        url={streamUri}
                        controls
                        width="100%"
                        height="100%"
                        playing
                        muted={muted}
                      />
                    })()}
                    <div className="stream-overlay">
                      <code>{streamUri}</code>
                    </div>
                  </div>
                ) : streamUri ? (
                   /* RTSP Detected but not supported in-app */
                   <div className="remote-placeholder" style={{ animation: 'none' }}>
                    <MonitorOff size={48} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <h3 style={{ margin: 0 }}>RTSP Stream Detected</h3>
                      <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>In-app playback not supported for RTSP</p>
                      <div style={{ marginTop: '15px' }}>
                        <button className="accent-btn" onClick={() => {
                          setIsExternalOpen(true);
                          invoke("open_in_mpv", { url: streamUri, noAudio: muted });
                        }}>
                          Launch External Player
                        </button>
                      </div>
                    </div>
                  </div>
                ) : snapshotUri ? (
                  <div className="snapshot-container">
                    <img src={snapshotUri} alt="Camera Snapshot" className="snapshot-img" />
                    <div className="snapshot-label">Snapshot View (Static)</div>
                  </div>
                ) : (
                  <div className="player-placeholder">
                    <Video size={48} className="icon-dim" />
                    <p>Connecting to stream...</p>
                  </div>
                )}

                {(isExternalOpen || !showPanels) && (
                   renderPtzControls(true)
                )}
              </div>
            </section>

            <div className={`dashboard-grid ${!showPanels ? 'hidden' : ''}`}>
              {/* Device Info */}
              <section className="card glass info-card">
                <h3><Cpu size={18} /> Device Information</h3>
                {info ? (
                  <div className="info-grid">
                    <div className="info-item">
                      <label>Manufacturer</label>
                      <span>{info.manufacturer}</span>
                    </div>
                    <div className="info-item">
                      <label>Model</label>
                      <span>{info.model}</span>
                    </div>
                    <div className="info-item">
                      <label>Firmware</label>
                      <span>{info.firmware_version}</span>
                    </div>
                    <div className="info-item">
                      <label>Serial</label>
                      <span>{info.serial_number}</span>
                    </div>
                    <div className="info-item">
                      <label>Stable ID</label>
                      <span title={info.hardware_id}>{info.hardware_id.substring(0, 12)}...</span>
                    </div>
                  </div>
                ) : (
                  <div className="skeleton-text">Fetching device info...</div>
                )}
              </section>

              {/* Profiles & Settings */}
              <section className="card glass settings-card">
                <h3><Settings size={18} /> Stream Profile</h3>
                <div className="form-group">
                  <label>Select Profile</label>
                  <select
                    value={selectedProfile}
                    onChange={(e) => {
                      const token = e.target.value;
                      setSelectedProfile(token);
                      if (services?.media) {
                        getStreamUri(services.media, token);
                        getSnapshotUri(services.media, token);
                        fetchVideoConfig(services.media, token);
                      }
                    }}
                    className="glass-select"
                  >
                    {profiles.map(p => (
                      <option key={p.token} value={p.token}>{p.name}</option>
                    ))}
                    {profiles.length === 0 && <option>No profiles found</option>}
                  </select>
                </div>

                {streamUri && (
                  <div className="form-group" style={{ marginTop: '15px' }}>
                    <label>Stream URI</label>
                    <div className="uri-display glass">
                      <code>{streamUri}</code>
                    </div>
                  </div>
                )}

                <div className="control-summary">
                  <div className="summary-item">
                    <div className="summary-label">
                      <MonitorOff size={16} />
                      <span>OSD Removal</span>
                    </div>
                    <button className="accent-btn sm" onClick={disableOsd} disabled={loading}>Apply</button>
                  </div>
                  <div className="summary-item">
                    <div className="summary-label">
                      <RefreshCw size={16} />
                      <span>I-Frame Sync</span>
                    </div>
                    <button className="accent-btn sm" onClick={syncIFrame} disabled={loading}>Apply</button>
                  </div>
                </div>
              </section>

              {/* Stream Stats */}
              <section className="card glass stats-card">
                <h3><Info size={18} /> Stream Statistics</h3>
                {videoConfig ? (
                  <div className="info-grid">
                    <div className="info-item">
                      <label>Resolution</label>
                      <span>{videoConfig.width}x{videoConfig.height}</span>
                    </div>
                    <div className="info-item">
                      <label>Encoding</label>
                      <span>{videoConfig.encoding}</span>
                    </div>
                    <div className="info-item">
                      <label>Frame Rate</label>
                      <span>{videoConfig.fps} FPS</span>
                    </div>
                    <div className="info-item">
                      <label>I-Frame Interval</label>
                      <span>{videoConfig.gov_length}</span>
                    </div>
                    <div className="info-item">
                      <label>Bitrate Limit</label>
                      <span>{(videoConfig.bitrate_limit / 1024).toFixed(1)} Mbps</span>
                    </div>
                    <div className="info-item">
                      <label>Quality</label>
                      <span>{videoConfig.quality}</span>
                    </div>
                  </div>
                ) : (
                  <div className="skeleton-text">Fetching stream stats...</div>
                )}
              </section>

              {/* PTZ Controls */}
              {renderPtzControls()}

              {/* Advanced Settings */}
              <section className="card glass advanced-card">
                <h3><Settings size={18} /> Advanced Configuration</h3>
                {videoConfig ? (
                  <div className="advanced-form">
                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                      <div className="form-group">
                        <label>Frame Rate (FPS)</label>
                        <div className="range-info">Limit: {videoConfig.min_fps} - {videoConfig.max_fps}</div>
                        <input
                          type="number"
                          min={videoConfig.min_fps}
                          max={videoConfig.max_fps}
                          value={videoConfig.fps}
                          onChange={(e) => setVideoConfig({ ...videoConfig, fps: parseInt(e.target.value) })}
                          className="glass-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>Image Quality</label>
                        <div className="range-info">Limit: {videoConfig.min_quality} - {videoConfig.max_quality}</div>
                        <input
                          type="number"
                          min={videoConfig.min_quality}
                          max={videoConfig.max_quality}
                          step="0.1"
                          value={videoConfig.quality}
                          onChange={(e) => setVideoConfig({ ...videoConfig, quality: parseFloat(e.target.value) })}
                          className="glass-input"
                        />
                      </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '15px' }}>
                      <label>I-Frame (GOP)</label>
                      <input
                        type="number"
                        value={videoConfig.gov_length}
                        onChange={(e) => setVideoConfig({ ...videoConfig, gov_length: parseInt(e.target.value) })}
                        className="glass-input"
                      />
                    </div>
                    <div className="form-group" style={{ marginTop: '15px' }}>
                      <label>OSD Text</label>
                      <div className="osd-input-group" style={{ display: 'flex', gap: '10px' }}>
                        <input
                          type="text"
                          value={osdText}
                          onChange={(e) => setOsdText(e.target.value)}
                          className="glass-input"
                          style={{ flex: 1 }}
                          placeholder="Custom Overlay Text"
                        />
                        <button className="accent-btn sm" onClick={updateOsd} disabled={loading} style={{ padding: '8px 15px' }}>Apply</button>
                      </div>
                    </div>
                    <div className="form-actions" style={{ marginTop: '20px' }}>
                      <button className="glow-btn sm" onClick={updateVideoSettings} disabled={loading} style={{ width: '100%' }}>
                        Save Video Settings
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="skeleton-text">Load a profile to configure...</div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="welcome-screen">
            <CameraIcon size={80} className="icon-dim" />
            <h1>ONVIF Stream Debugger</h1>
            <p>Select or discover a camera to begin debugging streams.</p>
            <button className="glow-btn large" onClick={discover} disabled={loading}>
              Discover Devices
            </button>
          </div>
        )}
      </main>

      {/* Auth Modal */}
      {authModalOpen && (
        <div className="modal-overlay">
          <div className="modal card glass">
            <h3><Fingerprint size={20} /> Camera Authentication</h3>
            <p>This camera requires credentials to access services.</p>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="glass-input"
                placeholder="admin"
              />
            </div>
            <div className="form-group" style={{ marginTop: '15px' }}>
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-input"
                placeholder="••••••••"
              />
            </div>
            <div className="modal-actions" style={{ marginTop: '25px' }}>
              <button className="glass-btn" onClick={() => setAuthModalOpen(false)}>Cancel</button>
              <button className="accent-btn" onClick={submitAuth}>Connect</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .app-container {
          display: flex;
          width: 100%;
          height: 100vh;
          background: #0d0f14;
        }

        .sidebar {
          width: 300px;
          display: flex;
          flex-direction: column;
          padding: 20px;
          border-right: 1px solid rgba(255, 255, 255, 0.05);
          z-index: 10;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }

        .sidebar-header h2 {
          font-size: 1.2rem;
          font-weight: 600;
          background: linear-gradient(135deg, #fff 0%, #aaa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .discover-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 12px;
          margin-bottom: 20px;
        }

        .camera-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .camera-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .camera-item:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .camera-item.active {
          background: rgba(124, 77, 255, 0.1);
          border-color: var(--accent);
        }

        .cam-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(124, 77, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }

        .cam-details {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .cam-name {
          font-weight: 600;
          font-size: 0.9rem;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .cam-mac {
          font-size: 0.75rem;
          color: var(--text-dim);
        }

        .status-bar {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-dim);
          font-size: 0.8rem;
        }

        .main-content {
          flex: 1;
          overflow-y: auto;
          padding: 40px;
          background: radial-gradient(circle at top right, rgba(124, 77, 255, 0.05), transparent 40%);
        }

        .welcome-screen {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 20px;
        }

        .welcome-screen p {
          color: var(--text-dim);
          max-width: 400px;
        }

        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 30px;
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .header-info h1 {
          margin: 0 0 10px 0;
          font-size: 2rem;
          background: linear-gradient(to right, #fff, #888);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .identifiers {
          display: flex;
          gap: 15px;
        }

        .tag {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.05);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.75rem;
          color: var(--text-dim);
        }

        .accent-btn {
          background: linear-gradient(135deg, var(--accent) 0%, #512da8 100%);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 15px rgba(124, 77, 255, 0.4);
          transition: all 0.3s ease;
        }

        .accent-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(124, 77, 255, 0.6);
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
        }

        .card {
          padding: 24px;
          border-radius: 20px;
        }

        .card h3 {
          margin: 0 0 20px 0;
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.1rem;
          color: var(--accent);
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .info-item label {
          font-size: 0.75rem;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .info-item span {
          font-weight: 500;
        }

        .stats-card, .advanced-card {
          grid-column: span 1;
        }

        .skeleton-text {
          color: var(--text-dim);
          font-style: italic;
          padding: 20px 0;
        }

        .advanced-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .form-row {
          margin-bottom: 15px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .range-info {
          font-size: 0.65rem;
          color: var(--accent);
          opacity: 0.8;
          margin-top: -4px;
        }

        .glass-select, .glass-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          padding: 10px;
          border-radius: 8px;
          outline: none;
        }

        .glass-select option {
          background: #1a1a1a;
        }

        .preview-card {
          margin-bottom: 24px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .preview-card.fullscreen {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1000;
          margin: 0;
          border-radius: 0;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .toggle-group {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 15px;
          border-radius: 8px;
          font-size: 0.75rem;
          color: var(--text-dim);
        }

        .toggle-group input {
          cursor: pointer;
          accent-color: var(--accent);
        }

        .preview-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .player-wrapper {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          overflow: hidden;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .player-container {
          width: 100%;
          height: 100%;
        }

        .remote-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 15px;
          color: var(--accent);
          background: linear-gradient(135deg, rgba(124, 77, 255, 0.1), rgba(0, 0, 0, 0.4));
          width: 100%;
          height: 100%;
          animation: pulse 2s infinite ease-in-out;
        }

        @keyframes pulse {
           0% { opacity: 0.7; }
           50% { opacity: 1; }
           100% { opacity: 0.7; }
        }

        .remote-placeholder span {
          background: var(--accent);
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: bold;
          text-transform: uppercase;
          box-shadow: 0 0 20px rgba(124, 77, 255, 0.4);
        }

        .ptz-overlay {
          position: absolute;
          bottom: 20px;
          right: 20px;
          z-index: 100;
          background: rgba(0, 0, 0, 0.6) !important;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          pointer-events: auto;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
          width: auto !important;
          max-width: 300px;
          transform: scale(0.9);
          transform-origin: bottom right;
        }

        .sidebar.hidden {
          display: none;
        }

        .main-content.minimal {
          padding-left: 20px;
        }

        .dashboard-grid.hidden {
          display: none;
        }

        .panel-toggle-btn {
          position: fixed;
          left: 20px;
          bottom: 20px;
          z-index: 1100;
          background: var(--accent);
          color: white;
          border-radius: 50%;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(0,0,0,0.4);
          transition: all 0.2s;
        }

        .panel-toggle-btn:hover {
          transform: scale(1.1);
          background: #9575cd;
        }

        .player-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
          color: var(--text-dim);
        }

        .stream-overlay {
          position: absolute;
          bottom: 10px;
          left: 10px;
          background: rgba(0, 0, 0, 0.6);
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 0.7rem;
          color: #fff;
          z-index: 10;
        }

        .snapshot-container {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .snapshot-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .snapshot-label {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(124, 77, 255, 0.6);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.6rem;
          text-transform: uppercase;
        }

        .uri-display {
          padding: 12px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.2);
          overflow-x: auto;
          font-size: 0.85rem;
          color: #a5d6a7;
        }

        .control-summary {
          margin-top: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .summary-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--text-dim);
          font-size: 0.9rem;
        }

        .summary-label {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .ptz-card {
          grid-column: span 1;
        }

        .ptz-container {
          display: flex;
          align-items: center;
          justify-content: space-around;
          gap: 30px;
        }

        .dpad {
          position: relative;
          width: 160px;
          height: 160px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .ptz-btn, .glass-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .glass-btn.sm {
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 0.75rem;
        }

        .ptz-btn:active, .glass-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: scale(0.95);
        }

        .dpad .ptz-btn {
          position: absolute;
          width: 44px;
          height: 44px;
        }

        .up { top: 10px; left: 58px; }
        .down { bottom: 10px; left: 58px; }
        .left { left: 10px; top: 58px; }
        .right { right: 10px; top: 58px; }

        .home {
          top: 58px;
          left: 58px;
          background: rgba(124, 77, 255, 0.2) !important;
          border-radius: 50% !important;
          border: 1px solid rgba(124, 77, 255, 0.4) !important;
        }

        .home:hover {
          background: rgba(124, 77, 255, 0.4) !important;
        }

        .zoom-controls {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .zoom-controls .ptz-btn {
          padding: 12px 20px;
          gap: 8px;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }

        .modal {
          width: 400px;
          animation: modalSlide 0.3s ease-out;
        }

        @keyframes modalSlide {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        .glass-btn {
          padding: 10px 20px;
        }

        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-dim);
          font-size: 0.9rem;
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .large {
          padding: 15px 40px;
          font-size: 1.1rem;
        }

        .presets-section {
          margin-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 15px;
        }

        .presets-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .presets-header h4 {
          margin: 0;
          font-size: 0.9rem;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .presets-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .presets-list.scrollable {
          max-height: 150px;
          overflow-y: auto;
          padding-right: 5px;
        }

        .presets-list.scrollable::-webkit-scrollbar {
          width: 4px;
        }

        .presets-list.scrollable::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }

        .presets-list.scrollable::-webkit-scrollbar-thumb {
          background: rgba(124, 77, 255, 0.3);
          border-radius: 4px;
        }

        .preset-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.2s ease;
        }

        .preset-item:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(124, 77, 255, 0.3);
          transform: translateY(-1px);
        }

        .preset-name {
          font-size: 0.85rem;
          cursor: pointer;
        }

        .delete-preset-btn {
          background: none;
          border: none;
          color: var(--text-dim);
          font-size: 1.1rem;
          padding: 0 2px;
          line-height: 1;
          cursor: pointer;
          transition: color 0.2s;
        }

        .delete-preset-btn:hover {
          color: #ff5252;
        }

        .update-preset-btn {
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          padding: 0 2px;
          display: flex;
          align-items: center;
          transition: color 0.2s;
        }

        .update-preset-btn:hover {
          color: var(--accent);
        }

        .no-presets {
          font-size: 0.85rem;
          color: var(--text-dim);
          opacity: 0.6;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

export default App;
