import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../theme/app_theme.dart';
import 'custom_button.dart';

class DocumentCaptureModal extends StatefulWidget {
  final String tabId;
  final String encryptionPin;

  const DocumentCaptureModal(
      {super.key, required this.tabId, required this.encryptionPin});

  @override
  State<DocumentCaptureModal> createState() => _DocumentCaptureModalState();
}

class _DocumentCaptureModalState extends State<DocumentCaptureModal> {
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _contentController = TextEditingController();
  final TextEditingController _amountController = TextEditingController();
  String _selectedType =
      'receipt'; // 'receipt' | 'note' | 'invoice' | 'id_card'
  bool _isSaving = false;
  File? _imageFile;

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: source, imageQuality: 75);
      if (picked != null) {
        setState(() {
          _imageFile = File(picked.path);
        });
        // Auto-fill title if empty
        if (_titleController.text.isEmpty) {
          _titleController.text =
              'Scanned Receipt ${DateTime.now().hour}:${DateTime.now().minute}';
        }
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Could not access camera/gallery.'),
            backgroundColor: AppTheme.accentRose),
      );
    }
  }

  void _handleSave() async {
    if (_titleController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please enter a title.'),
            backgroundColor: AppTheme.accentRose),
      );
      return;
    }

    setState(() => _isSaving = true);

    String plainContent = _contentController.text.trim();
    if (_imageFile != null && plainContent.isEmpty) {
      // Encode image as base64 string for secure encrypted database storage
      final bytes = await _imageFile!.readAsBytes();
      plainContent = '[IMAGE_BASE64]:${base64Encode(bytes)}';
    } else if (_imageFile != null) {
      final bytes = await _imageFile!.readAsBytes();
      plainContent =
          '${_contentController.text.trim()}\n[IMAGE_BASE64]:${base64Encode(bytes)}';
    }

    if (plainContent.isEmpty) {
      plainContent = 'Empty note payload';
    }

    final amount = double.tryParse(_amountController.text) ?? 0.0;
    final provider = Provider.of<WalletProvider>(context, listen: false);

    await provider.addDocument(
      tabId: widget.tabId,
      title: _titleController.text,
      type: _selectedType,
      plainContent: plainContent,
      amount: amount,
      encryptionPin: widget.encryptionPin,
    );

    setState(() => _isSaving = false);
    if (mounted) {
      Navigator.pop(context);
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
                Text('Capture Document / Receipt',
                    style: GoogleFonts.outfit(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary)),
                IconButton(
                    icon:
                        const Icon(Icons.close, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(context)),
              ],
            ),
            const SizedBox(height: 16),

            // TYPE SELECTOR
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _buildTypeChip('receipt', 'Receipt', Icons.receipt_long),
                  _buildTypeChip(
                      'note', 'Private Note', Icons.note_alt_outlined),
                  _buildTypeChip(
                      'invoice', 'Invoice', Icons.request_quote_outlined),
                  _buildTypeChip(
                      'id_card', 'ID Card / Pass', Icons.badge_outlined),
                ],
              ),
            ),
            const SizedBox(height: 16),

            TextField(
              controller: _titleController,
              style: GoogleFonts.outfit(fontSize: 16),
              decoration: const InputDecoration(
                  labelText: 'Document Title',
                  hintText: 'e.g. Hotel Bill, Passport Copy',
                  prefixIcon: Icon(Icons.title, color: AppTheme.accentCyan)),
            ),
            const SizedBox(height: 12),

            if (_selectedType == 'receipt' || _selectedType == 'invoice') ...[
              TextField(
                controller: _amountController,
                keyboardType: TextInputType.number,
                style: GoogleFonts.outfit(fontSize: 16),
                decoration: const InputDecoration(
                    labelText: 'Expense Amount (\$)',
                    hintText: '0.00',
                    prefixIcon: Icon(Icons.attach_money,
                        color: AppTheme.accentEmerald)),
              ),
              const SizedBox(height: 12),
            ],

            // CAMERA / GALLERY CAPTURE BUTTONS
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickImage(ImageSource.camera),
                    icon: const Icon(Icons.camera_alt_outlined,
                        color: AppTheme.accentCyan),
                    label: Text('Take Photo',
                        style: GoogleFonts.outfit(color: AppTheme.accentCyan)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: const BorderSide(color: AppTheme.accentCyan),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickImage(ImageSource.gallery),
                    icon: const Icon(Icons.photo_library_outlined,
                        color: AppTheme.accentIndigo),
                    label: Text('Upload Image',
                        style:
                            GoogleFonts.outfit(color: AppTheme.accentIndigo)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: const BorderSide(color: AppTheme.accentIndigo),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                  ),
                ),
              ],
            ),
            if (_imageFile != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                    color: AppTheme.accentEmerald.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(12)),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle,
                        color: AppTheme.accentEmerald, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text('Image Selected (Will be AES Encrypted)',
                            style: GoogleFonts.outfit(
                                color: AppTheme.accentEmerald,
                                fontSize: 13,
                                fontWeight: FontWeight.bold))),
                    IconButton(
                        icon: const Icon(Icons.delete_outline,
                            color: AppTheme.accentRose, size: 18),
                        onPressed: () => setState(() => _imageFile = null)),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),

            TextField(
              controller: _contentController,
              maxLines: 4,
              style: GoogleFonts.outfit(fontSize: 15),
              decoration: const InputDecoration(
                labelText: 'Notes / Text Content (AES-256 Encrypted)',
                hintText: 'Enter sensitive numbers, notes, or OCR text...',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 24),

            CustomButton(
              label: 'Encrypt & Save Document',
              icon: Icons.lock,
              isLoading: _isSaving,
              onPressed: _handleSave,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeChip(String id, String label, IconData icon) {
    final isSelected = _selectedType == id;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon,
                size: 16,
                color: isSelected
                    ? AppTheme.backgroundDark
                    : AppTheme.textSecondary),
            const SizedBox(width: 6),
            Text(label,
                style: GoogleFonts.outfit(
                    fontWeight:
                        isSelected ? FontWeight.bold : FontWeight.normal,
                    color: isSelected
                        ? AppTheme.backgroundDark
                        : AppTheme.textSecondary)),
          ],
        ),
        selected: isSelected,
        selectedColor: AppTheme.accentCyan,
        backgroundColor: AppTheme.backgroundDark,
        onSelected: (val) {
          if (val) setState(() => _selectedType = id);
        },
      ),
    );
  }
}
