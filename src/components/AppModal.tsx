import React from 'react';
import { Modal, ModalProps } from 'react-native';
import { useLockerStore } from '../store/useLockerStore';

/**
 * Every window in the app opens through this rather than React Native's Modal.
 *
 * A modal is its own native window, drawn above everything else, so the lock
 * screen could never be put over one. While the app is locked - or a
 * sensitive tab is waiting for its PIN again - each window is taken down
 * instead, and put back once the PIN is in. What it shows lives in the screen
 * that owns it, so it comes back as it was.
 */
export default function AppModal({ visible, ...rest }: ModalProps) {
  const hidden = useLockerStore(state => state.isLocked || state.relockTabId != null);
  return <Modal {...rest} visible={!!visible && !hidden} />;
}
