import { useRef, useEffect, useState } from 'react';

interface CameraCellProps {
  camName: string;
  mediamtxBase: string;
  isRecording: boolean;
  status: string;
  label: string;
}

export function CameraCell({ camName, mediamtxBase, isRecording, status, label }: CameraCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connStatus, setConnStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');

  useEffect(() => {
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const ac = new AbortController();

    const whepUrl = `${mediamtxBase}/${camName}`;

    const connect = async () => {
      if (cancelled) return;
      pc?.close();

      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        const s = pc!.connectionState;
        if (s === 'connected') {
          attempt = 0;
          setConnStatus('live');
        } else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          setConnStatus('reconnecting');
          scheduleRetry();
        }
      };

      pc.ontrack = (event) => {
        if (!cancelled && videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.addTransceiver('video', { direction: 'recvonly' });

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const resp = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription!.sdp,
          signal: ac.signal,
        });
        if (!resp.ok) throw new Error(`WHEP ${resp.status}`);
        const answer = await resp.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') {
          setConnStatus('reconnecting');
          scheduleRetry();
        }
      }
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      const delay = Math.min(15000, 1000 * Math.min(2 ** attempt, 10));
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      ac.abort();
      clearTimeout(retryTimer);
      pc?.close();
    };
  }, [camName, mediamtxBase]);

  const displayStatus = status === 'offline' ? 'offline' : connStatus;

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video border border-surface-border group">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${
          displayStatus === 'live' ? 'bg-brand' :
          displayStatus === 'connecting' || displayStatus === 'reconnecting' ? 'bg-yellow-400 animate-pulse' :
          'bg-red-500'
        }`} />
        <span className="text-[10px] text-white font-mono bg-black/60 px-2 py-0.5 rounded">{label}</span>
      </div>
      {isRecording && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-600/80 text-white text-[10px] px-2 py-0.5 rounded font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          REC
        </div>
      )}
      {displayStatus === 'reconnecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <span className="text-yellow-400 text-xs font-mono animate-pulse">RECONNECTING…</span>
        </div>
      )}
      {displayStatus === 'offline' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-text-muted text-xs font-mono">OFFLINE</span>
        </div>
      )}
    </div>
  );
}
