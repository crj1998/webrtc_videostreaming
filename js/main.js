'use strict';

let mediaRecorder;
let recordedBlobs;
let useRecord;

const offerOptions = {
    offerToReceiveAudio: 0,
    offerToReceiveVideo: 1
};

const localVideo = document.querySelector('video#localvideo');
const remoteVideo = document.querySelector('video#remotevideo');
localVideo.disabled = true;
remoteVideo.disabled = true;

const offerSdpTextarea = document.querySelector('div#offer textarea');
const answerSdpTextarea = document.querySelector('div#answer textarea');

const quickButton = document.querySelector('button#fastTest');
const getMediaButton = document.querySelector('button#getMedia');
const createConnectionButton = document.querySelector('button#createConnection');
const createOfferButton = document.querySelector('button#createOffer');
const setOfferButton = document.querySelector('button#setOffer');
const createAnswerButton = document.querySelector('button#createAnswer');
const setAnswerButton = document.querySelector('button#setAnswer');
const hangupButton = document.querySelector('button#hangup');
const downloadButton = document.querySelector('button#downloadbtn');
const useRecordCheckBox = document.querySelector('input#useRecord');
const videoLoopCheckBox = document.querySelector('input#videoLoop');
const bandwidthSelector = document.querySelector('select#bandwidth');


getMediaButton.onclick = getMedia;
createConnectionButton.onclick = createConnection;
createOfferButton.onclick = createOffer;
setOfferButton.onclick = setOffer;
createAnswerButton.onclick = createAnswer;
setAnswerButton.onclick = setAnswer;
hangupButton.onclick = hangup;

quickButton.onclick = () => {
    quickButton.disabled = true;
    setTimeout(getMedia, 100);
    setTimeout(createConnection, 200);
    setTimeout(createOffer, 300);
    setTimeout(setOffer, 400);
    setTimeout(createAnswer, 500);
    setTimeout(setAnswer, 600);
}

videoLoopCheckBox.onchange = () => {
    localVideo.loop = videoLoopCheckBox.checked;
}

let stream;
let receiveStream;
let pc1;
let pc2;
let startTime;

let bitrateGraph;
let bitrateSeries;
let headerrateSeries;

let packetGraph;
let packetSeries;

let fpsGraph;
let fpsSeries

let resolutionGraph;
let resolutionSeries;

let framesGraph;
let framesSendSeries;
let framesRecvSeries;
let framesGapSeries;
let smoothframesGapSeries;
let smoothlost = 0;
let lastResult;

let lastRemoteStart = 0;

const codecPreferences = document.getElementById('codecPreferences');

const { codecs } = RTCRtpSender.getCapabilities('video');
codecs.forEach(codec => {
    if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) { return; }
    const option = document.createElement('option');
    option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
    option.innerText = option.value;
    codecPreferences.appendChild(option);
});
codecPreferences.disabled = false;


function maybeCreateStream() {
    if (stream) { return; }
    if (localVideo.captureStream) {
        stream = localVideo.captureStream();
        console.log('Captured stream from localVideo with captureStream', stream);
        // call();
    } else if (localVideo.mozCaptureStream) {
        stream = localVideo.mozCaptureStream();
        console.log('Captured stream from localVideo with mozCaptureStream()', stream);
        // call();
    } else {
        console.log('captureStream() not supported');
    }
}

// Video tag capture must be set up after video tracks are enumerated.
localVideo.oncanplay = maybeCreateStream;
if (localVideo.readyState >= 3) { // HAVE_FUTURE_DATA
    // Video is already ready to play, call maybeCreateStream in case oncanplay
    // fired before we registered the event handler.
    maybeCreateStream();
}

function getMedia() {
    getMediaButton.disabled = true;

    const { codecs } = RTCRtpSender.getCapabilities('video');
    codecs.forEach(codec => {
        if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) { return; }
        const option = document.createElement('option');
        option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
        option.innerText = option.value;
        codecPreferences.appendChild(option);
    });
    codecPreferences.disabled = false;

    // localVideo.disabled = false;
    // remoteVideo.disabled = false;

    createConnectionButton.disabled = false;

    remoteVideo.onloadedmetadata = () => {
        console.log(`Remote video videoWidth: ${remoteVideo.videoWidth}px,  videoHeight: ${remoteVideo.videoHeight}px`);
    };

    remoteVideo.onresize = () => {
        console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
        // We'll use the first onresize callback as an indication that video has started playing out.
        if (startTime) {
            const elapsedTime = window.performance.now() - startTime;
            console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
            startTime = null;
        }
    };
}

function createConnection() {
    createConnectionButton.disabled = true;
    createOfferButton.disabled = false;
    console.log('Starting call');

    startTime = window.performance.now();
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    if (videoTracks.length > 0) {
        console.log(`Using video device: ${videoTracks[0].label}`);
    }
    if (audioTracks.length > 0) {
        console.log(`Using audio device: ${audioTracks[0].label}`);
    }
    const servers = null;

    pc1 = new RTCPeerConnection(servers);
    console.log('Created local peer connection object pc1');
    pc1.onicecandidate = e => onIceCandidate(pc1, e);

    pc2 = new RTCPeerConnection(servers);
    console.log('Created remote peer connection object pc2');
    pc2.onicecandidate = e => onIceCandidate(pc2, e);
    pc1.oniceconnectionstatechange = e => onIceStateChange(pc1, e);
    pc2.oniceconnectionstatechange = e => onIceStateChange(pc2, e);
    pc2.ontrack = gotRemoteStream;

    stream.getTracks().forEach(track => {if (track.kind=='audio'){return;};pc1.addTrack(track, stream);});
    // console.log('Added local stream to pc1');
    // console.log('Adding Local Stream to peer connection');

    const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== '') {
        const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
        const { codecs } = RTCRtpSender.getCapabilities('video');
        const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
        const selectedCodec = codecs[selectedCodecIndex];
        codecs.splice(selectedCodecIndex, 1);
        codecs.unshift(selectedCodec);
        // console.log(codecs);
        const transceiver = pc1.getTransceivers().find(t => t.sender && t.sender.track === stream.getVideoTracks()[0]);
        transceiver.setCodecPreferences(codecs);
        console.log('Preferred video codec', selectedCodec);
    }
    codecPreferences.disabled = true;

    bitrateSeries = new TimelineDataSeries();
    bitrateGraph = new TimelineGraphView('bitrateGraph', 'bitrateCanvas');
    bitrateGraph.updateEndDate();
  
    headerrateSeries = new TimelineDataSeries();
    headerrateSeries.setColor('green');
  
    packetSeries = new TimelineDataSeries();
    packetGraph = new TimelineGraphView('packetGraph', 'packetCanvas');
    packetGraph.updateEndDate();

    fpsSeries = new TimelineDataSeries();
    fpsGraph = new TimelineGraphView('fpsGraph', 'fpsCanvas');
    fpsGraph.updateEndDate();

    resolutionSeries = new TimelineDataSeries();
    resolutionGraph = new TimelineGraphView('resolutionGraph', 'resolutionCanvas');
    resolutionGraph.updateEndDate();

    framesSendSeries = new TimelineDataSeries();
    framesRecvSeries = new TimelineDataSeries();
    // framesRecvSeries.setColor('green');
    framesGapSeries = new TimelineDataSeries();
    smoothframesGapSeries = new TimelineDataSeries();
    smoothframesGapSeries.setColor('green');
    framesGraph = new TimelineGraphView('framesGraph', 'framesCanvas');
    framesGraph.updateEndDate();
}

async function createOffer() {
    try {
        const offer = await pc1.createOffer(offerOptions);
        // const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex].value;
        // if (!(bandwidth === 'unlimited')){
        //     offer.sdp = updateBandwidthRestriction(offer.sdp, bandwidth)
        // }
        offerSdpTextarea.disabled = false;
        offerSdpTextarea.value = offer.sdp;
        createOfferButton.disabled = true;
        setOfferButton.disabled = false;
    } catch (e) {
        onCreateSessionDescriptionError(e);
    }
}

async function setOffer() {
    // Restore the SDP from the textarea. Ensure we use CRLF which is what is generated
    // even though https://tools.ietf.org/html/rfc4566#section-5 requires
    // parsers to handle both LF and CRLF.
    const sdp = offerSdpTextarea.value.split('\n').map(l => l.trim()).join('\r\n');
    const offer = { type: 'offer', sdp: sdp };
    console.log(`Modified Offer from localPeerConnection\n${sdp}`);

    try {
        // eslint-disable-next-line no-unused-vars
        const ignore = await pc1.setLocalDescription(offer);
        console.log('Set session description success.');
        setOfferButton.disabled = true;
    } catch (e) {
        onSetSessionDescriptionError(e);
        return;
    }

    try {
        // eslint-disable-next-line no-unused-vars
        const ignore = await pc2.setRemoteDescription(offer);
        console.log('Set session description success.');
        createAnswerButton.disabled = false;
    } catch (e) {
        onSetSessionDescriptionError(e);
        return;
    }
}


async function createAnswer() {
    // Since the 'remote' side has no media stream we need
    // to pass in the right constraints in order for it to
    // accept the incoming offer of audio and video.
    try {
        const answer = await pc2.createAnswer();
        const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex].value;
        if (!(bandwidth === 'unlimited')){
            answer.sdp = updateBandwidthRestriction(answer.sdp, bandwidth)
        }
        answerSdpTextarea.disabled = false;
        answerSdpTextarea.value = answer.sdp;
        createAnswerButton.disabled = true;
        setAnswerButton.disabled = false;
    } catch (e) {
        onCreateSessionDescriptionError(e);
    }
}

async function setAnswer() {
    setAnswerButton.disabled = false;
    // Restore the SDP from the textarea. Ensure we use CRLF which is what is generated
    // even though https://tools.ietf.org/html/rfc4566#section-5 requires
    // parsers to handle both LF and CRLF.
    const sdp = answerSdpTextarea.value.split('\n').map(l => l.trim()).join('\r\n');
    const answer = { type: 'answer', sdp: sdp };

    try {
        // eslint-disable-next-line no-unused-vars
        const ignore = await pc2.setLocalDescription(answer);
        console.log('Set session description success.');
        setAnswerButton.disabled = true;
    } catch (e) {
        onSetSessionDescriptionError(e);
        return;
    }

    console.log(`Modified Answer from remotePeerConnection\n${sdp}`);
    try {
        // eslint-disable-next-line no-unused-vars
        const ignore = await pc1.setRemoteDescription(answer);
        console.log('Set session description success.');
    } catch (e) {
        onSetSessionDescriptionError(e);
        return;
    }
    hangupButton.disabled = false;
    createOfferButton.disabled = false;

    localVideo.play();
    // startRecording();

    // setTimeout(hangup, 120*1000);
}


localVideo.onplay = () => {
    receiveStream = remoteVideo.captureStream();
    startRecording();
}
localVideo.onended = () => {
    stopRecording();
    receiveStream = null;
}

function hangup() {
    console.log('Ending call');
    stream.getTracks().forEach(track => track.stop());
    pc1.close();
    pc2.close();
    pc1 = null;
    pc2 = null;
    offerSdpTextarea.disabled = true;
    answerSdpTextarea.disabled = true;
    getMediaButton.disabled = false;
    createConnectionButton.disabled = true;
    createOfferButton.disabled = true;
    setOfferButton.disabled = true;
    createAnswerButton.disabled = true;
    setAnswerButton.disabled = true;
    hangupButton.disabled = true;

    localVideo.pause();
}


// window.setInterval(() => {
//     if (!receiveStream) {return; }
//     const settings = receiveStream.getVideoTracks()[0].getSettings();
//     console.log(settings);
// }, 500);

// query getStats every second
window.setInterval(() => {
    if (!pc1) {return; }
    const sender = pc1.getSenders()[0];
    const receiver = pc2.getReceivers()[0];
    if (!sender) { return; }
    if (!receiver) {return; }
    receiver.getStats().then(res => {
        res.forEach(report => {
            let framesDecoded;
            let frameHeight;
            let frameWidth;
            let framesPerSecond;
            if (report.type === "inbound-rtp") {
                // console.log("inbound-rtp", report);
                const now = report.timestamp;
                framesDecoded   = report.framesDecoded;
                frameHeight     = report.frameHeight;
                frameWidth      = report.frameWidth;
                framesPerSecond = report.framesPerSecond;
                document.getElementById('video_width').innerText = frameWidth;
                document.getElementById('video_height').innerText = frameHeight;
                document.getElementById('video_fps').innerText = framesPerSecond;

                fpsSeries.addPoint(now, framesPerSecond);
                fpsGraph.setDataSeries([fpsSeries]);
                fpsGraph.updateEndDate();
                span_fps.innerText = framesPerSecond;

                resolutionSeries.addPoint(now, frameHeight);
                resolutionGraph.setDataSeries([resolutionSeries]);
                resolutionGraph.updateEndDate();
                span_resolution.innerText = frameHeight;
                
                // recvFrames = report.framesRecv;
                // framesRecvSeries.addPoint(now, report.framesRecv);
                // framesRecvSeries.addPoint(now, recvFrames);
                // framesGraph.setDataSeries([framesRecvSeries, framesSendSeries]);
                if (sendFrames>10){
                    let r = (sendFrames - recvFrames)/sendFrames*100;
                    // r = Math.max(r, 0);
                    // smoothlost = 0.5*smoothlost + 0.5*r;
                    smoothlost = 0.99*smoothlost + 0.01*r;
                    // span_frames.innerText = Math.round(r);
                    span_frames.innerText = Math.max(smoothlost, 0).toFixed(2);
                    framesGapSeries.addPoint(now, r);
                    smoothframesGapSeries.addPoint(now, smoothlost);
                    framesGraph.setDataSeries([framesGapSeries, smoothframesGapSeries]);
                    framesGraph.updateEndDate();
                }

            }
        });
    });

    sender.getStats().then(res => {
        res.forEach(report => {
            let bytes;
            let headerBytes;
            let packets;
            let nacks;
            // console.log(report.type);
            // console.log(report.framesDecoded );
            if (report.type === "outbound-rtp") {
                if (report.isRemote) { return; }
                // console.log("outbound-rtp", report);
                const now = report.timestamp;
                bytes = report.bytesSent;
                headerBytes = report.headerBytesSent;
                nacks = report.nackCount;
                // report.framesSent;
                // console.log(report);

                packets = report.packetsSent;
                if (lastResult && lastResult.has(report.id)) {
                    // calculate bitrate
                    const bitrate = 8 * (bytes - lastResult.get(report.id).bytesSent) /
                        (now - lastResult.get(report.id).timestamp);
                    const headerrate = 8 * (headerBytes - lastResult.get(report.id).headerBytesSent) /
                        (now - lastResult.get(report.id).timestamp);

                    // append to chart
                    bitrateSeries.addPoint(now, bitrate);
                    headerrateSeries.addPoint(now, headerrate);
                    bitrateGraph.setDataSeries([bitrateSeries, headerrateSeries]);
                    bitrateGraph.updateEndDate();

                    // calculate number of packets and append to chart
                    packetSeries.addPoint(now, packets - lastResult.get(report.id).packetsSent);
                    packetGraph.setDataSeries([packetSeries]);
                    packetGraph.updateEndDate();
                    
                    // sendFrames = report.framesSent;
                    // framesSendSeries.addPoint(now, report.framesSent);
                    // framesSendSeries.addPoint(now, sendFrames);
                }
            }
        });
        lastResult = res;
    });
}, 200);



// localVideo.play();

function onCreateSessionDescriptionError(error) {
    console.log(`Failed to create session description: ${error.toString()}`);
}

function onSetSessionDescriptionError(error) {
    console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(event) {
    // console.log("called");
    // console.log(event);
    if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        console.log('pc2 received remote stream', event);
    }
}


function onIceCandidate(pc, event) {
    getOtherPc(pc).addIceCandidate(event.candidate)
        .then(
            () => onAddIceCandidateSuccess(pc),
            err => onAddIceCandidateError(pc, err)
        );
    console.log(`${getName(pc)} ICE candidate: ${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess(pc) {
    console.log(`${getName(pc)} addIceCandidate success`);
}

function onAddIceCandidateError(pc, error) {
    console.log(`${getName(pc)} failed to add ICE Candidate: ${error.toString()}`);
}

function onIceStateChange(pc, event) {
    if (pc) {
        console.log(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
        console.log('ICE state change event: ', event);
    }
}

function getName(pc) { return (pc === pc1) ? 'pc1' : 'pc2'; }

function getOtherPc(pc) { return (pc === pc1) ? pc2 : pc1; }

function getSupportedMimeTypes() {
    const possibleTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=h264,opus',
        'video/mp4;codecs=h264,aac',
    ];
    return possibleTypes.filter(mimeType => {
        return MediaRecorder.isTypeSupported(mimeType);
    });
}

getSupportedMimeTypes().forEach(mimeType => {
    const option = document.createElement('option');
    option.value = mimeType;
    option.innerText = option.value;
    document.getElementById('codecSavePreferences').appendChild(option);
});

function handleDataAvailable(event) {
    console.log('handleDataAvailable', event);
    if (event && event.data && event.data.size > 0) {
        recordedBlobs.push(event.data);
    }
}

function startRecording() {
    if (!useRecordCheckBox.checked){
        return;
    }
    recordedBlobs = [];
    const mimeType = document.getElementById('codecSavePreferences').options[codecPreferences.selectedIndex].value;
    const options = {mimeType};
  
    try {
        let s = remoteVideo.captureStream();
        mediaRecorder = new MediaRecorder(s, options);
    } catch (e) {
        console.error('Exception while creating MediaRecorder:', e);
        return;
    }

    console.log('Created MediaRecorder', mediaRecorder, 'with options', options);
    mediaRecorder.onstop = (event) => {
        console.log('Recorder stopped: ', event);
        console.log('Recorded Blobs: ', recordedBlobs);
    };
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.start();
    console.log('MediaRecorder started', mediaRecorder);
  }
  
function stopRecording() {
    if (!useRecordCheckBox.checked){
        return;
    }
    mediaRecorder.stop();
    downloadButton.disabled = false;
}


downloadButton.onclick = () => {
    if (!useRecordCheckBox.checked){
        alert("not recorded!");
        return;
    }
    const blob = new Blob(recordedBlobs, {type: 'video/webm'});
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'demo.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
}

function updateBandwidthRestriction(sdp, bandwidth) {
    let modifier = 'AS';
    // if (adapter.browserDetails.browser === 'firefox') {
    //     bandwidth = (bandwidth >>> 0) * 1000;
    //     modifier = 'TIAS';
    // }
    if (sdp.indexOf('b=' + modifier + ':') === -1) {
        // insert b= after c= line.
        // or a=fmtp:96 x-google-max-bitrate=1200000;x-google-min-bitrate=800000;x-google-start-bitrate=1000000 
        sdp = sdp.replace(/c=IN (.*)\r\n/, 'c=IN $1\r\nb=' + modifier + ':' + bandwidth + '\r\n');
    } else {
        sdp = sdp.replace(new RegExp('b=' + modifier + ':.*\r\n'), 'b=' + modifier + ':' + bandwidth + '\r\n');
    }
    // console.log(sdp);
    return sdp;
}

function removeBandwidthRestriction(sdp) {
    return sdp.replace(/b=AS:.*\r\n/, '').replace(/b=TIAS:.*\r\n/, '');
}

// 如果SDP中没有限制码率的话，webRTC默认音频的最大码率为512，视频的最大码率为2M。
// cn doc https://www.cnblogs.com/cag2050/p/16292942.html
// renegotiate bandwidth on the fly.
bandwidthSelector.onchange = () => {
    // bandwidthSelector.disabled = true;
    const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex].value;
    // console.log('bandwidth:', bandwidth);

    // In Chrome, use RTCRtpSender.setParameters to change bandwidth without
    // (local) renegotiation. Note that this will be within the envelope of
    // the initial maximum bandwidth negotiated via SDP.
    if (!pc1){ return; }
    if ('RTCRtpSender' in window && 'setParameters' in window.RTCRtpSender.prototype) {
        const sender = pc1.getSenders()[0];
        const parameters = sender.getParameters();
        if (!parameters.encodings) {
            parameters.encodings = [{}];
        }
        if (bandwidth === 'unlimited') {
            delete parameters.encodings[0].maxBitrate;
        } else {
            parameters.encodings[0].maxBitrate = bandwidth * 1000;
        }
        sender.setParameters(parameters).then(() => {
            bandwidthSelector.disabled = false;
        }).catch(e => console.error(e));
        return;
    }
    // Fallback to the SDP munging with local renegotiation way of limiting
    // the bandwidth.
    pc1.createOffer()
        .then(offer => pc1.setLocalDescription(offer))
        .then(() => {
            const desc = {
                type: pc1.remoteDescription.type,
                sdp: bandwidth === 'unlimited' ?
                removeBandwidthRestriction(pc1.remoteDescription.sdp) :
                updateBandwidthRestriction(pc1.remoteDescription.sdp, bandwidth)
            };
            console.log('Applying bandwidth restriction to setRemoteDescription:\n' + desc.sdp);
            return pc1.setRemoteDescription(desc);
        })
        .then(() => {
            bandwidthSelector.disabled = false;
        })
        .catch(onSetSessionDescriptionError);
};

// requestVideoFrameCallback doc
// cn https://xie.infoq.cn/article/ba68979abd0dd3fda56307d9e
// en https://web.dev/requestvideoframecallback-rvfc/
const windowSize = 30;
let maxLocalDelay = -1;
// console.log(('requestVideoFrameCallback' in HTMLVideoElement.prototype));
let sendFrames = 0;
let recvFrames = 0;
let ts = 0;
localVideo.requestVideoFrameCallback(function rVFC(now, metaData) {
    // console.log('send', now);
    sendFrames += 1;
    
    // console.log('local', metaData);
    // For graph purposes, take the maximum over a window.
    maxLocalDelay = Math.max(1000 * (metaData.expectedDisplayTime - metaData.captureTime), maxLocalDelay);
    
    if (metaData.presentedFrames % windowSize !== 0) {
        localVideo.requestVideoFrameCallback(rVFC);
        return;
    }

    maxLocalDelay = -1;
    
    localVideo.requestVideoFrameCallback(rVFC);
});


let maxProcessingDuration = -1;
let maxRenderTime = -1;
let maxNetworkDelay = -1;

remoteVideo.requestVideoFrameCallback(function rVFC(now, metaData) {
    // console.log('recv', now);
    // if (now - ts > 100000){
    //     sendFrames = 0;
    //     recvFrames = 0;
    //     ts = now;
    // }
    recvFrames += 1;
    // console.log('remote', metaData);
    // For graph purposes, take the maximum over a window.
    maxProcessingDuration = Math.max(1000 * metaData.processingDuration, maxProcessingDuration);
    maxRenderTime = Math.max(metaData.expectedDisplayTime - metaData.receiveTime, maxRenderTime);
    // Note: captureTime is currently only present when there are bidirectional streams.
    maxNetworkDelay = Math.max(metaData.receiveTime - metaData.captureTime, maxNetworkDelay);
    
    if (metaData.presentedFrames % windowSize !== 0) {
        remoteVideo.requestVideoFrameCallback(rVFC);
        return;
    }

    maxProcessingDuration = -1;
    maxRenderTime = -1;
    maxNetworkDelay = -1;
    maxLocalDelay = -1;
    
    remoteVideo.requestVideoFrameCallback(rVFC);
});


resetbtn.onclick = function(){
    sendFrames = 0;
    recvFrames = 0;
    smoothlost = 0;
}
