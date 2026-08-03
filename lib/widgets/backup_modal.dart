import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../services/database_helper.dart';
import '../theme/app_theme.dart';
import 'glass_card.dart';
import 'custom_button.dart';

class BackupModal extends StatefulWidget {
  const BackupModal({super.key});

  @override
  State<BackupModal> createState() => _BackupModalState();
}

class _BackupModalState extends State<BackupModal> {
  final TextEditingController _importController = TextEditingController();
  bool _isExporting = false;
  bool _isImporting = false;

  @override
  void dispose() {
    _importController.dispose();
    super.dispose();
  }

  Future<void> _exportToFile() async {
    setState(() => _isExporting = true);
    try {
      final jsonStr = await DatabaseHelper.instance.exportBackupData();
      if (kIsWeb) {
        await Share.shareXFiles(
          [XFile.fromData(utf8.encode(jsonStr), name: 'ewallet_backup.json', mimeType: 'application/json')],
          text: 'My Encrypted eWallet Vault Backup (JSON)',
          subject: 'eWallet Backup',
        );
      } else {
        final dir = await getTemporaryDirectory();
        final file = File('${dir.path}/ewallet_backup_${DateTime.now().millisecondsSinceEpoch}.json');
        await file.writeAsString(jsonStr);

        await Share.shareXFiles(
          [XFile(file.path)],
          text: 'My Encrypted eWallet Vault Backup (JSON)',
          subject: 'eWallet Backup',
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to export backup.'), backgroundColor: AppTheme.accentRose),
        );
      }
    } finally {
      if (mounted) setState(() => _isExporting = false);
    }
  }

  Future<void> _copyToClipboard() async {
    setState(() => _isExporting = true);
    try {
      final jsonStr = await DatabaseHelper.instance.exportBackupData();
      await Clipboard.setData(ClipboardData(text: jsonStr));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('✨ Encrypted Backup copied to clipboard!'), backgroundColor: AppTheme.accentEmerald),
        );
      }
    } finally {
      if (mounted) setState(() => _isExporting = false);
    }
  }

  Future<void> _importFromFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['json', 'txt'],
      );

      if (result != null && result.files.single.path != null) {
        setState(() => _isImporting = true);
        final file = File(result.files.single.path!);
        final content = await file.readAsString();
        await _processImport(content);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Error reading file.'), backgroundColor: AppTheme.accentRose),
        );
      }
    } finally {
      if (mounted) setState(() => _isImporting = false);
    }
  }

  Future<void> _processImport(String jsonStr) async {
    final success = await DatabaseHelper.instance.importBackupData(jsonStr.trim());
    if (success) {
      final provider = Provider.of<WalletProvider>(context, listen: false);
      await provider.checkExistingUsers();
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('✨ Vault Data Successfully Restored!'), backgroundColor: AppTheme.accentEmerald),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Invalid backup JSON payload.'), backgroundColor: AppTheme.accentRose),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: AppTheme.surfaceDark,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.cloud_sync_rounded, color: AppTheme.accentCyan, size: 26),
                    const SizedBox(width: 10),
                    Text('Vault Backup & Restore', style: GoogleFonts.outfit(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  ],
                ),
                IconButton(icon: const Icon(Icons.close, color: AppTheme.textSecondary), onPressed: () => Navigator.pop(context)),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Export your encrypted SQLite database as a JSON file to transfer between Android and iOS devices, or import an existing backup.',
              style: GoogleFonts.outfit(color: AppTheme.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 24),

            // EXPORT SECTION
            GlassCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Export Encrypted Vault', style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 4),
                  Text('Contains users, tabs, budgets, and AES ciphertext.', style: GoogleFonts.outfit(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: CustomButton(
                          label: 'Share / Save File',
                          icon: Icons.share_outlined,
                          isLoading: _isExporting,
                          onPressed: _exportToFile,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: CustomButton(
                          label: 'Copy JSON',
                          icon: Icons.copy,
                          isOutline: true,
                          onPressed: _copyToClipboard,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // IMPORT SECTION
            GlassCard(
              padding: const EdgeInsets.all(18),
              borderColor: AppTheme.accentIndigo.withOpacity(0.5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Restore From Backup', style: GoogleFonts.outfit(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 4),
                  Text('Warning: Importing will overwrite the existing database on this device.', style: GoogleFonts.outfit(fontSize: 12, color: AppTheme.accentRose)),
                  const SizedBox(height: 16),
                  CustomButton(
                    label: 'Select Backup File (.json)',
                    icon: Icons.folder_open_rounded,
                    color: AppTheme.accentIndigo,
                    isLoading: _isImporting,
                    onPressed: _importFromFile,
                  ),
                  const SizedBox(height: 16),
                  Text('Or Paste JSON String:', style: GoogleFonts.outfit(fontSize: 13, color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _importController,
                    maxLines: 3,
                    style: GoogleFonts.outfit(fontSize: 13).copyWith(fontFamily: 'Courier'),
                    decoration: const InputDecoration(hintText: 'Paste {"version": "1.0", ...} here'),
                  ),
                  const SizedBox(height: 12),
                  CustomButton(
                    label: 'Restore From Pasted JSON',
                    icon: Icons.restore_rounded,
                    isOutline: true,
                    color: AppTheme.accentEmerald,
                    onPressed: () {
                      if (_importController.text.trim().isNotEmpty) {
                        _processImport(_importController.text);
                      }
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
