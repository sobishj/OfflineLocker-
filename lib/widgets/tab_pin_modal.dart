import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../models/tab_model.dart';
import '../theme/app_theme.dart';
import 'glass_card.dart';
import 'custom_button.dart';

class TabPinModal extends StatefulWidget {
  final TabModel tab;
  final Function(String) onSuccess;

  const TabPinModal({super.key, required this.tab, required this.onSuccess});

  @override
  State<TabPinModal> createState() => _TabPinModalState();
}

class _TabPinModalState extends State<TabPinModal> {
  final TextEditingController _pinController = TextEditingController();
  bool _obscurePin = true;
  String? _error;

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  void _verify() {
    if (_pinController.text.trim().length != 4) {
      setState(() => _error = 'Secondary PIN must be exactly 4 digits!');
      return;
    }
    final provider = Provider.of<WalletProvider>(context, listen: false);
    final isValid = provider.verifyTabPin(widget.tab, _pinController.text);

    if (isValid) {
      Navigator.pop(context);
      widget.onSuccess(_pinController.text.trim());
    } else {
      setState(() {
        _error = 'Invalid secondary PIN for this vault tab.';
        _pinController.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      child: GlassCard(
        padding: const EdgeInsets.all(24),
        borderColor: AppTheme.accentRose.withOpacity(0.5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.accentRose.withOpacity(0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.enhanced_encryption_rounded,
                      color: AppTheme.accentRose, size: 28),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Sensitive Vault Tab',
                          style: GoogleFonts.outfit(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary)),
                      Text(widget.tab.name,
                          style: GoogleFonts.outfit(
                              fontSize: 14,
                              color: AppTheme.accentRose,
                              fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              'Enter the secondary PIN assigned to this tab to unlock and decrypt stored documents.',
              style: GoogleFonts.outfit(
                  color: AppTheme.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 20),
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.accentRose.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_error!,
                    style: GoogleFonts.outfit(
                        color: AppTheme.accentRose, fontSize: 13)),
              ),
              const SizedBox(height: 14),
            ],
            TextField(
              controller: _pinController,
              obscureText: _obscurePin,
              keyboardType: TextInputType.number,
              maxLength: 4,
              style: GoogleFonts.outfit(
                  fontSize: 18, letterSpacing: 6, fontWeight: FontWeight.bold),
              decoration: InputDecoration(
                labelText: 'Tab PIN (4 Digits)',
                hintText: '••••',
                counterText: '',
                prefixIcon: const Icon(Icons.key, color: AppTheme.accentRose),
                suffixIcon: IconButton(
                  icon: Icon(
                      _obscurePin ? Icons.visibility_off : Icons.visibility,
                      color: AppTheme.textSecondary),
                  onPressed: () => setState(() => _obscurePin = !_obscurePin),
                ),
              ),
              onSubmitted: (_) => _verify(),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text('Cancel',
                      style: GoogleFonts.outfit(
                          color: AppTheme.textSecondary, fontSize: 16)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: CustomButton(
                    label: 'Unlock Tab',
                    icon: Icons.lock_open_rounded,
                    color: AppTheme.accentRose,
                    onPressed: _verify,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
