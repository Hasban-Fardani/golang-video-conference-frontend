import './style.css';

interface SignalMessage {
    type: string;
    payload?: any;
    target?: string;
    sender?: string;
    roomId?: string;
}

const websocketBaseUrl = import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8080";
const stunServerUrl = import.meta.env.VITE_STUN_SERVER_URL || "stun:stun.l.google.com:19302";

document.addEventListener('DOMContentLoaded', () => {

    const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
    const remoteVideosContainer = document.getElementById('videos') as HTMLDivElement;
    const roomIdInput = document.getElementById('roomIdInput') as HTMLInputElement;
    const joinRoomBtn = document.getElementById('joinRoomBtn') as HTMLButtonElement;
    const muteAudioBtn = document.getElementById('muteAudioBtn') as HTMLButtonElement;
    const disableVideoBtn = document.getElementById('disableVideoBtn') as HTMLButtonElement;

    if (!localVideo) {
        throw Error("No localvideo")
    }

    if (!joinRoomBtn) {
        throw Error("No join button")
    }

    if (!roomIdInput) {
        throw Error("No room id input")
    }

    if (!remoteVideosContainer || remoteVideosContainer === null) {
        throw Error("No remote videos container")
    }

    if (!muteAudioBtn) {
        throw Error("No mute audio button")
    }

    if (!disableVideoBtn) {
        throw Error("No disable video button")
    }

    let localStream: MediaStream;
    let peerConnections: { [key: string]: RTCPeerConnection } = {};
    let ws: WebSocket;
    let myPeerId = 'peer-' + Math.random().toString(36).substring(2, 9); // ID unik sederhana
    let currentRoomId;

    // Konfigurasi STUN server (gunakan server publik Google untuk memulai)
    const configuration = {
        iceServers: [
            { urls: stunServerUrl },
            // Tambahkan TURN server jika Anda punya untuk NAT traversal yang lebih baik
            // {
            //   urls: 'turn:your.turn.server.com:3478',
            //   username: 'user',
            //   credential: 'password'
            // }
        ]
    };

    joinRoomBtn.addEventListener('click', async () => {
        currentRoomId = roomIdInput.value.trim();
        if (!currentRoomId) {
            alert('Please enter a Room ID');
            return;
        }

        try {
            // 1. Dapatkan media lokal
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            joinRoomBtn.disabled = true;
            roomIdInput.disabled = true;

            // 2. Koneksi WebSocket ke signaling server
            // Ganti localhost:8080 dengan alamat server Anda jika berbeda
            ws = new WebSocket(`${websocketBaseUrl}/${currentRoomId}/${myPeerId}`);

            ws.onopen = () => {
                console.log('WebSocket connection established');
                // Server akan mengirim pesan "new-peer" dari peer lain, atau kita bisa memintanya
            };

            ws.onmessage = async (event) => {
                const message = JSON.parse(event.data) as SignalMessage;
                console.log('Received message:', message);

                const { type, payload, sender, target } = message;

                // Abaikan pesan yang bukan untuk kita (jika server broadcast semua)
                // ATAU jika target ada dan bukan kita
                if (target && target !== myPeerId && type !== 'peer-left' && type !== 'new-peer') {
                    console.log(`Message for ${target}, not me (${myPeerId}). Ignoring.`);
                    return;
                }


                switch (type) {
                    case 'new-peer': // Peer baru bergabung
                        if (sender !== myPeerId) {
                            console.log(`New peer ${sender} joined. Creating offer.`);
                            if (!sender) throw Error("sender undefined!")
                            createAndSendOffer(sender);
                        }
                        break;
                    case 'offer': // Menerima offer dari peer
                        if (sender !== myPeerId) {
                            console.log(`Received offer from ${sender}. Creating answer.`);
                            if (!sender) throw Error("sender undefined!")
                            handleOffer(sender, payload);
                        }
                        break;
                    case 'answer': // Menerima answer dari peer
                        if (sender !== myPeerId) {
                            console.log(`Received answer from ${sender}.`);
                            if (!sender) throw Error("sender undefined!")
                            handleAnswer(sender, payload);
                        }
                        break;
                    case 'candidate': // Menerima ICE candidate dari peer
                        if (sender !== myPeerId) {
                            console.log(`Received ICE candidate from ${sender}.`);
                            if (!sender) throw Error("sender undefined!")
                            handleCandidate(sender, payload);
                        }
                        break;
                    case 'peer-left':
                        if (sender !== myPeerId) {
                            console.log(`Peer ${sender} left.`);
                            if (!sender) throw Error("sender undefined!")
                            handlePeerLeft(sender);
                        }
                        break;
                    default:
                        console.warn('Unknown message type:', type);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                alert('WebSocket connection error. See console.');
            };

            ws.onclose = () => {
                console.log('WebSocket connection closed');
                alert('WebSocket connection closed.');
                joinRoomBtn.disabled = false;
                roomIdInput.disabled = false;
            };

        } catch (error: any) {
            console.error('Error joining room:', error);
            alert('Could not join room: ' + error.message);
        }
    });

    function getOrCreatePeerConnection(peerId: string) {
        if (!peerConnections[peerId]) {
            const pc = new RTCPeerConnection(configuration);

            // Tambahkan track dari localStream ke koneksi baru ini
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            // Handler saat remote track diterima
            pc.ontrack = (event) => {
                console.log(`Track received from ${peerId}:`, event.streams[0]);
                let remoteVideo = document.getElementById(`video-${peerId}`) as HTMLVideoElement | null;
                if (!remoteVideo) {
                    const videoDiv = document.createElement('div');
                    videoDiv.id = `video-container-${peerId}`;
                    videoDiv.innerHTML = `<h2 class="text-xl">Remote: ${peerId}</h2>`;
                    remoteVideo = document.createElement('video');
                    remoteVideo.id = `video-${peerId}`;
                    remoteVideo.autoplay = true;
                    remoteVideo.playsInline = true;
                    remoteVideo.classList.add('w-full', 'h-auto', 'border');
                    videoDiv.appendChild(remoteVideo);
                    remoteVideosContainer.appendChild(videoDiv);
                }
                remoteVideo.srcObject = event.streams[0];
            };

            // Handler untuk ICE candidate
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log(`Sending ICE candidate to ${peerId}:`, event.candidate);
                    sendMessage({
                        type: 'candidate',
                        payload: event.candidate,
                        target: peerId,
                        sender: myPeerId
                    });
                }
            };

            pc.oniceconnectionstatechange = () => {
                console.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
                if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                    // handlePeerLeft(peerId); // Bisa jadi terlalu agresif, mungkin butuh reconnection logic
                }
            };
            peerConnections[peerId] = pc;
        }
        return peerConnections[peerId];
    }

    async function createAndSendOffer(peerId: string) {
        const pc = getOrCreatePeerConnection(peerId);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`Sending offer to ${peerId}:`, offer);
            sendMessage({
                type: 'offer',
                payload: pc.localDescription, // SDP
                target: peerId,
                sender: myPeerId
            });
        } catch (error) {
            console.error(`Error creating offer for ${peerId}:`, error);
        }
    }

    async function handleOffer(peerId: string, offerSdp: RTCSessionDescriptionInit) {
        const pc = getOrCreatePeerConnection(peerId);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`Sending answer to ${peerId}:`, answer);
            sendMessage({
                type: 'answer',
                payload: pc.localDescription, // SDP
                target: peerId,
                sender: myPeerId
            });
        } catch (error) {
            console.error(`Error handling offer from ${peerId}:`, error);
        }
    }

    async function handleAnswer(peerId: string, answerSdp: RTCSessionDescriptionInit) {
        const pc = getOrCreatePeerConnection(peerId);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
            console.log(`Remote description set for ${peerId} after answer.`);
        } catch (error) {
            console.error(`Error handling answer from ${peerId}:`, error);
        }
    }

    async function handleCandidate(peerId: string, candidate: RTCIceCandidateInit) {
        const pc = getOrCreatePeerConnection(peerId);
        try {
            if (candidate) { // Pastikan candidate tidak null/kosong
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`ICE candidate added for ${peerId}.`);
            }
        } catch (error) {
            console.error(`Error adding ICE candidate from ${peerId}:`, error);
        }
    }

    function handlePeerLeft(peerId: string) {
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
        const remoteVideoContainer = document.getElementById(`video-container-${peerId}`);
        if (remoteVideoContainer) {
            remoteVideoContainer.remove();
        }
        console.log(`Cleaned up for peer ${peerId}`);
    }

    function sendMessage(message: SignalMessage) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        } else {
            console.error('WebSocket is not open. Cannot send message:', message);
        }
    }

    // Kontrol Media
    muteAudioBtn.addEventListener('click', () => {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            muteAudioBtn.textContent = audioTrack.enabled ? 'Mute Audio' : 'Unmute Audio';
            muteAudioBtn.classList.toggle('btn-warning', !audioTrack.enabled);
        }
    });

    disableVideoBtn.addEventListener('click', () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            disableVideoBtn.textContent = videoTrack.enabled ? 'Disable Video' : 'Enable Video';
            disableVideoBtn.classList.toggle('btn-warning', !videoTrack.enabled);
            // Jika video dinonaktifkan, mungkin tampilkan placeholder
            localVideo.style.display = videoTrack.enabled ? 'block' : 'none';
        }
    });
})