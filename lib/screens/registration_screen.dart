import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/custom_button.dart';

class RegistrationScreen extends StatefulWidget {
  const RegistrationScreen({super.key});

  @override
  State<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends State<RegistrationScreen> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();
  final TextEditingController _confirmPinController = TextEditingController();
  bool _obscurePin = true;

  @override
  void dispose() {
    _usernameController.dispose();
    _pinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  void _handleRegister() async {
    if (_pinController.text.trim().length != 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Master PIN must be exactly 4 digits!'), backgroundColor: AppTheme.accentRose),
      );
      return;
    }
    if (_pinController.text != _confirmPinController.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('PINs do not match!'), backgroundColor: AppTheme.accentRose),
      );
      return;
    }
    final provider = Provider.of<WalletProvider>(context, listen: false);
    final success = await provider.registerUser(_usernameController.text, _pinController.text);
    if (success && mounted) {
      Navigator.pop(context); // Return to auth/dashboard
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<WalletProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Create Vault Account'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF0F172A), Color(0xFF0A0E17)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Setup Your Security',
                    style: GoogleFonts.outfit(fontSize: 26, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Create a unique username and a secure 4-6 digit master PIN to encrypt your vault.',
                    style: GoogleFonts.outfit(fontSize: 15, color: AppTheme.textSecondary),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 28),

                  GlassCard(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (provider.errorMessage != null) ...[
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppTheme.accentRose.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              provider.errorMessage!,
                              style: GoogleFonts.outfit(color: AppTheme.accentRose, fontSize: 14),
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],

                        TextField(
                          controller: _usernameController,
                          style: GoogleFonts.outfit(fontSize: 16),
                          decoration: const InputDecoration(
                            labelText: 'Username',
                            hintText: 'e.g. satoshi_nakamoto',
                            prefixIcon: Icon(Icons.person_outline, color: AppTheme.accentCyan),
                          ),
                        ),
                        const SizedBox(height: 16),

                        TextField(
                          controller: _pinController,
                          obscureText: _obscurePin,
                          keyboardType: TextInputType.number,
                          maxLength: 4,
                          style: GoogleFonts.outfit(fontSize: 18, letterSpacing: 6, fontWeight: FontWeight.bold),
                          decoration: InputDecoration(
                            labelText: 'Master PIN (4 Digits)',
                            hintText: '••••',
                            counterText: '',
                            prefixIcon: const Icon(Icons.lock_outline, color: AppTheme.accentCyan),
                            suffixIcon: IconButton(
                              icon: Icon(_obscurePin ? Icons.visibility_off : Icons.visibility, color: AppTheme.textSecondary),
                              onPressed: () => setState(() => _obscurePin = !_obscurePin),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),

                        TextField(
                          controller: _confirmPinController,
                          obscureText: _obscurePin,
                          keyboardType: TextInputType.number,
                          maxLength: 4,
                          style: GoogleFonts.outfit(fontSize: 18, letterSpacing: 6, fontWeight: FontWeight.bold),
                          decoration: const InputDecoration(
                            labelText: 'Confirm Master PIN (4 Digits)',
                            hintText: '••••',
                            counterText: '',
                            prefixIcon: Icon(Icons.lock_reset_outlined, color: AppTheme.accentCyan),
                          ),
                        ),
                        const SizedBox(height: 24),

                        CustomButton(
                          label: 'Initialize Encrypted Vault',
                          icon: Icons.shield_rounded,
                          isLoading: provider.isLoading,
                          onPressed: _handleRegister,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
