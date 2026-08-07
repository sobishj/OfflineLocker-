import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

export default function WebCamera({ onCapture, onClose }: { onCapture: (base64: string) => void, onClose: () => void }) {
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.container}>
        <Text style={{color: 'white'}}>WebCamera is only for web.</Text>
      </View>
    );
  }

  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const [stream, setStream] = useState<any>(null);

  useEffect(() => {
    let activeStream: any = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((s) => {
        activeStream = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch((err) => {
        console.error("Camera error:", err);
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track: any) => track.stop());
      }
    };
  }, []);

  const takePicture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg', 0.8);
      onCapture(dataUri);
      if (stream) {
        stream.getTracks().forEach((track: any) => track.stop());
      }
    }
  };

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach((track: any) => track.stop());
    }
    onClose();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
          <Ionicons name="close" size={32} color="#fff" />
        </TouchableOpacity>
      </View>
      <View style={styles.cameraContainer}>
        {React.createElement('video', {
          ref: videoRef,
          autoPlay: true,
          playsInline: true,
          style: { width: '100%', height: '100%', objectFit: 'cover' }
        })}
        {React.createElement('canvas', {
          ref: canvasRef,
          style: { display: 'none' }
        })}
      </View>
      <View style={styles.footer}>
        <TouchableOpacity onPress={takePicture} style={styles.captureButton}>
          <View style={styles.captureInner} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 20, paddingTop: 40, alignItems: 'flex-end', position: 'absolute', top: 0, width: '100%', zIndex: 10 },
  closeBtn: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 4 },
  cameraContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  footer: { padding: 30, alignItems: 'center', position: 'absolute', bottom: 0, width: '100%' },
  captureButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  captureInner: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#000' }
});
