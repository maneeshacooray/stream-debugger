use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State};
use onvif_discover::{
    get_device_information as discover_get_device_info, normalize_stable_id, 
    Credentials as DiscoverCredentials,
};
use futures_util::StreamExt;
use std::collections::HashMap;
use onvif::soap;
use schema::media;
use schema::devicemgmt;
use schema::ptz;
use schema::onvif as tt;
use schema::transport;
use tauri::Emitter;
use url::Url;
use base64::{Engine as _, engine::general_purpose};
use reqwest::header::AUTHORIZATION;

// We will store the discovered devices and credentials in Tauri's managed state
pub struct AppState {
    pub devices: Arc<Mutex<HashMap<String, AppDeviceInfo>>>,
    pub credentials: Arc<Mutex<Option<soap::client::Credentials>>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AppDeviceInfo {
    pub name: Option<String>,
    pub url: Vec<String>,
    pub address: String,
    pub stable_id: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct AppDeviceInformation {
    pub manufacturer: String,
    pub model: String,
    pub firmware_version: String,
    pub serial_number: String,
    pub hardware_id: String,
}

#[derive(serde::Serialize, Clone)]
pub struct AppDeviceServices {
    pub media: Option<String>,
    pub ptz: Option<String>,
    pub device_mgmt: String,
}

#[derive(serde::Serialize, Clone)]
pub struct AppProfile {
    pub token: String,
    pub name: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AppVideoEncoderConfiguration {
    pub token: String,
    pub encoding: String,
    pub width: i32,
    pub height: i32,
    pub quality: f64,
    pub fps: i32,
    pub gov_length: i32,
    pub bitrate_limit: i32,
    pub min_quality: f64,
    pub max_quality: f64,
    pub min_fps: i32,
    pub max_fps: i32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AppPtzPosition {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
    pub pan_tilt_space: Option<String>,
    pub zoom_space: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AppPtzPreset {
    pub token: String,
    pub name: Option<String>,
}

async fn get_client(url: &str, state: &State<'_, AppState>) -> Result<soap::client::Client, String> {
    let uri = Url::parse(url).map_err(|e| e.to_string())?;
    let creds = state.credentials.lock().await;
    let mut builder = soap::client::ClientBuilder::new(&uri);
    if let Some(c) = creds.as_ref() {
        builder = builder.credentials(Some(c.clone()));
    }
    Ok(builder.build())
}

async fn get_discover_creds(state: &State<'_, AppState>) -> Option<DiscoverCredentials> {
    let creds = state.credentials.lock().await;
    creds.as_ref().map(|c| DiscoverCredentials {
        username: c.username.clone(),
        password: c.password.clone(),
    })
}

#[tauri::command]
pub async fn set_credentials(
    username: String, 
    password: String, 
    state: State<'_, AppState>
) -> Result<(), String> {
    let mut creds = state.credentials.lock().await;
    *creds = Some(soap::client::Credentials { username, password });
    Ok(())
}

#[tauri::command]
pub async fn discover_cameras(state: State<'_, AppState>) -> Result<Vec<AppDeviceInfo>, String> {
    use onvif::discovery;
    
    // Run a single discovery probe to populate the tracker
    let discovery = discovery::DiscoveryBuilder::default().run().await.map_err(|e| e.to_string())?;
    
    let devices_arc = state.devices.clone();
    
    discovery.for_each_concurrent(10, |device| {
        let devices = devices_arc.clone();
        async move {
            let mut info = AppDeviceInfo {
                name: device.name.clone(),
                url: device.urls.iter().map(|u| u.to_string()).collect(),
                address: device.address.clone(),
                stable_id: None,
            };
            
            if let Some(url) = device.urls.first() {
                let url_str = url.to_string();
                if let Ok(dev_info) = discover_get_device_info(&url_str).await {
                    info.stable_id = dev_info.hardware_id.or(dev_info.serial_number);
                }
            }
            
            let key = info.stable_id.as_ref()
                .filter(|s| !s.is_empty())
                .map(|s| normalize_stable_id(s))
                .filter(|k| !k.is_empty())
                .unwrap_or_else(|| info.address.clone());
                
            let mut devices = devices.lock().await;
            devices.insert(key, info);
        }
    }).await;

    let devices = state.devices.lock().await;
    Ok(devices.values().cloned().collect())
}

#[tauri::command]
pub async fn fetch_device_info(url: String) -> Result<AppDeviceInformation, String> {
    let di = discover_get_device_info(&url).await.map_err(|e| e.to_string())?;
    Ok(AppDeviceInformation {
        manufacturer: di.manufacturer.unwrap_or_default(),
        model: di.model.unwrap_or_default(),
        firmware_version: di.firmware_version.unwrap_or_default(),
        serial_number: di.serial_number.unwrap_or_default(),
        hardware_id: di.hardware_id.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn fetch_services(device_mgmt_url: String, state: State<'_, AppState>) -> Result<AppDeviceServices, String> {
    let client = get_client(&device_mgmt_url, &state).await?;
    let resp = devicemgmt::get_services(&client, &devicemgmt::GetServices { include_capability: true })
        .await
        .map_err(|e: transport::Error| e.to_string())?;
    
    let mut services = AppDeviceServices {
        media: None,
        ptz: None,
        device_mgmt: device_mgmt_url.clone(),
    };
    
    for s in resp.service {
        match s.namespace.as_str() {
            "http://www.onvif.org/ver10/media/wsdl" => services.media = Some(s.x_addr),
            "http://www.onvif.org/ver20/ptz/wsdl" => services.ptz = Some(s.x_addr),
            _ => {}
        }
    }
    
    Ok(services)
}

#[tauri::command]
pub async fn fetch_profiles(device_media_url: String, state: State<'_, AppState>) -> Result<Vec<AppProfile>, String> {
    let client = get_client(&device_media_url, &state).await?;
    let resp = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(resp.profiles.into_iter().map(|p| AppProfile {
        token: p.token.0,
        name: p.name.0,
    }).collect())
}

#[tauri::command]
pub async fn fetch_stream_uri(
    device_media_url: String, 
    profile_token: String, 
    protocol: Option<String>,
    state: State<'_, AppState>
) -> Result<String, String> {
    let client = get_client(&device_media_url, &state).await?;
    
    let transport_protocol = match protocol.as_deref() {
        Some("Http") => tt::TransportProtocol::Http,
        Some("Tcp") => tt::TransportProtocol::Tcp,
        Some("Udp") => tt::TransportProtocol::Udp,
        _ => tt::TransportProtocol::Rtsp,
    };

    let resp = media::get_stream_uri(&client, &media::GetStreamUri {
        profile_token: tt::ReferenceToken(profile_token),
        stream_setup: tt::StreamSetup {
            stream: tt::StreamType::RtpUnicast,
            transport: tt::Transport {
                protocol: transport_protocol,
                tunnel: vec![],
            },
        },
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(resp.media_uri.uri)
}

#[tauri::command]
pub async fn fetch_snapshot_uri(device_media_url: String, profile_token: String, state: State<'_, AppState>) -> Result<String, String> {
    let client = get_client(&device_media_url, &state).await?;
    let resp = media::get_snapshot_uri(&client, &media::GetSnapshotUri {
        profile_token: tt::ReferenceToken(profile_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(resp.media_uri.uri)
}

#[tauri::command]
pub async fn proxy_snapshot(url: String, state: State<'_, AppState>) -> Result<String, String> {
    let creds = state.credentials.lock().await;
    let client = reqwest::Client::new();
    let mut rb = client.get(&url);

    if let Some(c) = creds.as_ref() {
        // Many cameras support Basic Auth for snapshots
        let auth = format!("{}:{}", c.username, c.password);
        let encoded = general_purpose::STANDARD.encode(auth);
        rb = rb.header(AUTHORIZATION, format!("Basic {}", encoded));
    }

    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
        
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    
    Ok(format!("data:{};base64,{}", content_type, b64))
}

#[tauri::command]
pub async fn open_in_mpv(window: tauri::Window, url: String, no_audio: bool) -> Result<(), String> {
    use tokio::process::Command;
    use std::process::Stdio;
    
    let mut args = vec![
        "--loop-file=inf".to_string(),
        "--rtsp-transport=tcp".to_string(),
        "--profile=low-latency".to_string(),
        "--title=Camera Stream Preview (External)".to_string(),
        "--autofit=640x360".to_string(),
    ];
    
    if no_audio {
        args.push("--no-audio".to_string());
    }
    
    args.push(url);

    let mut child = Command::new("mpv")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start mpv: {e}"))?;
        
    // Spawn task to notify when it closes
    tokio::spawn(async move {
        let _ = child.wait().await;
        let _ = window.emit("mpv-closed", ());
    });

    Ok(())
}

#[tauri::command]
pub async fn ptz_continuous_move(
    device_ptz_url: String, 
    profile_token: String, 
    pan: f64, 
    tilt: f64, 
    zoom: f64,
    state: State<'_, AppState>
) -> Result<(), String> {
    let creds = get_discover_creds(&state).await;
    onvif_discover::continuous_move(&device_ptz_url, &profile_token, pan, tilt, zoom, creds.as_ref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ptz_absolute_move(
    device_ptz_url: String, 
    profile_token: String, 
    pan: f64, 
    tilt: f64, 
    zoom: f64,
    pan_tilt_space: Option<String>,
    zoom_space: Option<String>,
    state: State<'_, AppState>
) -> Result<(), String> {
    let client = get_client(&device_ptz_url, &state).await?;
    
    // Some cameras ignore moves if speed is not set or if spaces are missing
    let request = ptz::AbsoluteMove {
        profile_token: tt::ReferenceToken(profile_token),
        position: tt::Ptzvector {
            pan_tilt: Some(schema::common::Vector2D {
                x: pan,
                y: tilt,
                space: pan_tilt_space,
            }),
            zoom: Some(schema::common::Vector1D {
                x: zoom,
                space: zoom_space,
            }),
        },
        speed: Some(tt::Ptzspeed {
            pan_tilt: Some(schema::common::Vector2D {
                x: 1.0, // Max speed
                y: 1.0,
                space: None,
            }),
            zoom: Some(schema::common::Vector1D {
                x: 1.0,
                space: None,
            }),
        }),
    };

    ptz::absolute_move(&client, &request).await.map_err(|e: transport::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ptz_stop(device_ptz_url: String, profile_token: String, state: State<'_, AppState>) -> Result<(), String> {
    let creds = get_discover_creds(&state).await;
    onvif_discover::stop(&device_ptz_url, &profile_token, creds.as_ref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ptz_get_presets(
    device_ptz_url: String, 
    profile_token: String, 
    state: State<'_, AppState>
) -> Result<Vec<AppPtzPreset>, String> {
    let client = get_client(&device_ptz_url, &state).await?;
    let resp = ptz::get_presets(&client, &ptz::GetPresets {
        profile_token: tt::ReferenceToken(profile_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(resp.preset.into_iter().map(|p| AppPtzPreset {
        token: p.token.as_ref().map(|t| t.0.clone()).unwrap_or_default(),
        name: p.name.as_ref().map(|n| n.0.clone()),
    }).collect())
}

#[tauri::command]
pub async fn ptz_set_preset(
    device_ptz_url: String, 
    profile_token: String, 
    preset_name: Option<String>,
    preset_token: Option<String>,
    state: State<'_, AppState>
) -> Result<String, String> {
    let client = get_client(&device_ptz_url, &state).await?;
    let resp = ptz::set_preset(&client, &ptz::SetPreset {
        profile_token: tt::ReferenceToken(profile_token),
        preset_name,
        preset_token: preset_token.map(tt::ReferenceToken),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(resp.preset_token.0)
}

#[tauri::command]
pub async fn ptz_goto_preset(
    device_ptz_url: String, 
    profile_token: String, 
    preset_token: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    let client = get_client(&device_ptz_url, &state).await?;
    ptz::goto_preset(&client, &ptz::GotoPreset {
        profile_token: tt::ReferenceToken(profile_token),
        preset_token: tt::ReferenceToken(preset_token),
        speed: Some(tt::Ptzspeed {
            pan_tilt: Some(tt::Vector2D { x: 1.0, y: 1.0, space: None }),
            zoom: Some(tt::Vector1D { x: 1.0, space: None }),
        }),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn ptz_remove_preset(
    device_ptz_url: String, 
    profile_token: String, 
    preset_token: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    let client = get_client(&device_ptz_url, &state).await?;
    ptz::remove_preset(&client, &ptz::RemovePreset {
        profile_token: tt::ReferenceToken(profile_token),
        preset_token: tt::ReferenceToken(preset_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn ptz_get_status(
    device_ptz_url: String, 
    profile_token: String, 
    state: State<'_, AppState>
) -> Result<AppPtzPosition, String> {
    let client = get_client(&device_ptz_url, &state).await?;
    let resp = ptz::get_status(&client, &ptz::GetStatus {
        profile_token: tt::ReferenceToken(profile_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    let pos = resp.ptz_status.position.ok_or_else(|| "No position reported".to_string())?;
    
    Ok(AppPtzPosition {
        x: pos.pan_tilt.as_ref().map(|pt| pt.x).unwrap_or(0.0),
        y: pos.pan_tilt.as_ref().map(|pt| pt.y).unwrap_or(0.0),
        zoom: pos.zoom.as_ref().map(|z| z.x).unwrap_or(0.0),
        pan_tilt_space: pos.pan_tilt.as_ref().and_then(|pt| pt.space.clone()),
        zoom_space: pos.zoom.as_ref().and_then(|z| z.space.clone()),
    })
}

#[tauri::command]
pub async fn disable_osd(device_media_url: String, profile_token: String, state: State<'_, AppState>) -> Result<(), String> {
    let client = get_client(&device_media_url, &state).await?;
    
    let profiles = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    let profile = profiles.profiles.into_iter().find(|p| p.token.0 == profile_token)
        .ok_or_else(|| "Profile not found".to_string())?;
    
    let vs_token = if let Some(ref vsc) = profile.video_source_configuration {
        vsc.token.0.clone()
    } else {
        return Err("No VideoSourceConfiguration found for this profile".to_string());
    };
    
    let resp = media::get_os_ds(&client, &media::GetOSDs {
        configuration_token: tt::ReferenceToken(vs_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    for osd in resp.os_ds {
        media::delete_osd(&client, &media::DeleteOSD {
            osd_token: osd.token,
        }).await.map_err(|e: transport::Error| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn adjust_stream_settings(device_media_url: String, profile_token: String, state: State<'_, AppState>) -> Result<(), String> {
    let client = get_client(&device_media_url, &state).await?;
    let profiles = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    let profile = profiles.profiles.into_iter().find(|p| p.token.0 == profile_token)
        .ok_or_else(|| "Profile not found".to_string())?;
    
    let mut config = profile.video_encoder_configuration.ok_or_else(|| "No video encoder configuration on profile".to_string())?;
    
    if let Some(ref rc) = config.rate_control {
        let fps = rc.frame_rate_limit;
        if let Some(ref mut h264) = config.h264 {
            h264.gov_length = fps;
        }
        if let Some(ref mut mpeg4) = config.mpeg4 {
            mpeg4.gov_length = fps;
        }
        
        media::set_video_encoder_configuration(&client, &media::SetVideoEncoderConfiguration {
            configuration: config,
            force_persistence: true,
        }).await.map_err(|e: transport::Error| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn fetch_video_encoder_config(device_media_url: String, profile_token: String, state: State<'_, AppState>) -> Result<AppVideoEncoderConfiguration, String> {
    let client = get_client(&device_media_url, &state).await?;
    let profiles = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    let profile = profiles.profiles.into_iter().find(|p| p.token.0 == profile_token)
        .ok_or_else(|| "Profile not found".to_string())?;
    
    let config = profile.video_encoder_configuration.ok_or_else(|| "No video encoder configuration on profile".to_string())?;
    
    let resolution = config.resolution;
    let fps = config.rate_control.as_ref().map(|rc| rc.frame_rate_limit).unwrap_or(0);
    let bitrate_limit = config.rate_control.as_ref().map(|rc| rc.bitrate_limit).unwrap_or(0);
    
    let gov_length = if let Some(ref h264) = config.h264 {
        h264.gov_length
    } else if let Some(ref mpeg4) = config.mpeg4 {
        mpeg4.gov_length
    } else {
        0
    };

    // Fetch options for min/max
    let options = media::get_video_encoder_configuration_options(&client, &media::GetVideoEncoderConfigurationOptions {
        configuration_token: Some(tt::ReferenceToken(config.token.0.clone())),
        profile_token: Some(tt::ReferenceToken(profile_token)),
    }).await.map_err(|e: transport::Error| e.to_string())?;

    let (min_q, max_q) = (options.options.quality_range.min as f64, options.options.quality_range.max as f64);
    
    let (min_fps, max_fps) = if let Some(ref h264) = options.options.h264 {
        (h264.frame_rate_range.min, h264.frame_rate_range.max)
    } else if let Some(ref mpeg4) = options.options.mpeg4 {
        (mpeg4.frame_rate_range.min, mpeg4.frame_rate_range.max)
    } else {
        (24, 60)
    };

    Ok(AppVideoEncoderConfiguration {
        token: config.token.0,
        encoding: format!("{:?}", config.encoding),
        width: resolution.width,
        height: resolution.height,
        quality: config.quality,
        fps,
        gov_length,
        bitrate_limit,
        min_quality: min_q,
        max_quality: max_q,
        min_fps,
        max_fps,
    })
}

#[tauri::command]
pub async fn update_video_encoder_config(
    device_media_url: String, 
    profile_token: String, 
    new_config: AppVideoEncoderConfiguration,
    state: State<'_, AppState>
) -> Result<(), String> {
    let client = get_client(&device_media_url, &state).await?;
    let profiles = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    let profile = profiles.profiles.into_iter().find(|p| p.token.0 == profile_token)
        .ok_or_else(|| "Profile not found".to_string())?;
    
    let mut config = profile.video_encoder_configuration.ok_or_else(|| "No video encoder configuration on profile".to_string())?;
    
    config.quality = new_config.quality;
    if let Some(ref mut rc) = config.rate_control {
        rc.frame_rate_limit = new_config.fps;
        rc.bitrate_limit = new_config.bitrate_limit;
    }
    
    if let Some(ref mut h264) = config.h264 {
        h264.gov_length = new_config.gov_length;
    }
    if let Some(ref mut mpeg4) = config.mpeg4 {
        mpeg4.gov_length = new_config.gov_length;
    }

    media::set_video_encoder_configuration(&client, &media::SetVideoEncoderConfiguration {
        configuration: config,
        force_persistence: true,
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn set_osd_text(device_media_url: String, profile_token: String, text: String, state: State<'_, AppState>) -> Result<(), String> {
    let client = get_client(&device_media_url, &state).await?;
    let profiles = media::get_profiles(&client, &Default::default()).await.map_err(|e: transport::Error| e.to_string())?;
    let profile = profiles.profiles.into_iter().find(|p| p.token.0 == profile_token)
        .ok_or_else(|| "Profile not found".to_string())?;
    
    let vs_token = if let Some(ref vsc) = profile.video_source_configuration {
        vsc.token.0.clone()
    } else {
        return Err("No VideoSourceConfiguration found for this profile".to_string());
    };
    
    let resp = media::get_os_ds(&client, &media::GetOSDs {
        configuration_token: tt::ReferenceToken(vs_token),
    }).await.map_err(|e: transport::Error| e.to_string())?;
    
    for mut osd in resp.os_ds {
         if let Some(ref mut text_config) = osd.text_string {
             text_config.plain_text = Some(text);
             media::set_osd(&client, &media::SetOSD {
                 osd,
             }).await.map_err(|e: transport::Error| e.to_string())?;
             return Ok(());
         }
    }
    
    Err("No compatible text-based OSD found to update. Your camera might only support fixed text or images.".to_string())
}

pub fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        discover_cameras,
        fetch_device_info,
        set_credentials,
        fetch_services,
        fetch_profiles,
        fetch_stream_uri,
        fetch_snapshot_uri,
        proxy_snapshot,
        open_in_mpv,
        ptz_continuous_move,
        ptz_get_status,
        ptz_get_presets,
        ptz_set_preset,
        ptz_goto_preset,
        ptz_remove_preset,
        ptz_absolute_move,
        ptz_stop,
        disable_osd,
        set_osd_text,
        adjust_stream_settings,
        fetch_video_encoder_config,
        update_video_encoder_config,
    ])
}

