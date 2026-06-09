import { useRef, useEffect } from 'react';

interface CameraCellProps {
  camName: string;
  mediamtxBase: string;
  isRecording: boolean;
  status: string;
  label: string;
}

export function CameraCell({ camName, mediamtxBase, isRecording, status, label }: CameraCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const whepUrl = `${mediamtxBase}/${camName}`;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    const connect = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const resp = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription!.sdp,
        });
        if (!resp.ok) return;
        const answer = await resp.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        console.error(`WHEP connect failed for ${camName}:`, err);
      }
    };

    connect();
    return () => pc.close();
  }, [camName, mediamtxBase]);

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
        <span className={`inline-block w-2 h-2 rounded-full ${status === 'online' ? 'bg-brand' : status === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] text-white font-mono bg-black/60 px-2 py-0.5 rounded">{label}</span>
      </div>
      {isRecording && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-600/80 text-white text-[10px] px-2 py-0.5 rounded font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          REC
        </div>
      )}
      {status === 'offline' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-text-muted text-xs font-mono">OFFLINE</span>
        </div>
      )}
    </div>
  );
}
