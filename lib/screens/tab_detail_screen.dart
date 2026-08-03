import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../models/tab_model.dart';
import '../models/document_model.dart';
import '../services/crypto_service.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/custom_button.dart';
import '../widgets/document_capture_modal.dart';

class TabDetailScreen extends StatefulWidget {
  final TabModel tab;
  final String unlockedPin;

  const TabDetailScreen(
      {super.key, required this.tab, required this.unlockedPin});

  @override
  State<TabDetailScreen> createState() => _TabDetailScreenState();
}

class _TabDetailScreenState extends State<TabDetailScreen> {
  final Map<String, bool> _decryptedStates = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<WalletProvider>(context, listen: false)
          .loadDocumentsForTab(widget.tab.uuid);
    });
  }

  void _toggleDecrypt(String? docId) {
    if (docId == null) return;
    setState(() {
      _decryptedStates[docId] = !(_decryptedStates[docId] ?? false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<WalletProvider>(context);
    final docs = provider.activeDocuments;

    // Calculate spent amount from documents
    final totalSpent =
        docs.fold<double>(0.0, (sum, item) => sum + (item.amount ?? 0.0));
    final remainingBudget = widget.tab.budget - totalSpent;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.tab.name),
        actions: [
          if (widget.tab.isSensitive)
            Container(
              margin: const EdgeInsets.only(right: 16),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppTheme.accentRose.withOpacity(0.2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.accentRose.withOpacity(0.5)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.lock_open_rounded,
                      size: 14, color: AppTheme.accentRose),
                  const SizedBox(width: 4),
                  Text('UNLOCKED',
                      style: GoogleFonts.outfit(
                          color: AppTheme.accentRose,
                          fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            ),
        ],
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
          child: Column(
            children: [
              // --- BUDGET PROGRESS CARD ---
              Padding(
                padding: const EdgeInsets.all(20),
                child: GlassCard(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('BUDGET UTILIZATION',
                              style: GoogleFonts.outfit(
                                  color: AppTheme.textSecondary,
                                  fontSize: 12,
                                  letterSpacing: 1.2)),
                          Text(
                            '${(widget.tab.budget > 0 ? (totalSpent / widget.tab.budget * 100).clamp(0, 100) : 0).toStringAsFixed(1)}%',
                            style: GoogleFonts.outfit(
                                color: AppTheme.accentCyan,
                                fontWeight: FontWeight.bold,
                                fontSize: 14),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: LinearProgressIndicator(
                          value: widget.tab.budget > 0
                              ? (totalSpent / widget.tab.budget).clamp(0.0, 1.0)
                              : 0,
                          minHeight: 10,
                          backgroundColor: AppTheme.surfaceDark,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            remainingBudget < 0
                                ? AppTheme.accentRose
                                : AppTheme.accentCyan,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Total Spent',
                                  style: GoogleFonts.outfit(
                                      color: AppTheme.textSecondary,
                                      fontSize: 12)),
                              Text('\$${totalSpent.toStringAsFixed(2)}',
                                  style: GoogleFonts.outfit(
                                      color: AppTheme.textPrimary,
                                      fontSize: 20,
                                      fontWeight: FontWeight.bold)),
                            ],
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text('Remaining Budget',
                                  style: GoogleFonts.outfit(
                                      color: AppTheme.textSecondary,
                                      fontSize: 12)),
                              Text(
                                '\$${remainingBudget.toStringAsFixed(2)}',
                                style: GoogleFonts.outfit(
                                  color: remainingBudget < 0
                                      ? AppTheme.accentRose
                                      : AppTheme.accentEmerald,
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              // --- HEADER & SCAN BUTTON ---
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Encrypted Documents (${docs.length})',
                        style: GoogleFonts.outfit(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary)),
                    CustomButton(
                      label: 'Add Receipt / Note',
                      icon: Icons.add_a_photo_outlined,
                      onPressed: () => showModalBottomSheet(
                        context: context,
                        isScrollControlled: true,
                        backgroundColor: Colors.transparent,
                        builder: (_) => DocumentCaptureModal(
                          tabId: widget.tab.uuid,
                          encryptionPin: widget.unlockedPin,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // --- DOCUMENTS LIST ---
              Expanded(
                child: docs.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.shield_outlined,
                                size: 56,
                                color: AppTheme.textSecondary.withOpacity(0.4)),
                            const SizedBox(height: 16),
                            Text('No encrypted documents yet',
                                style: GoogleFonts.outfit(
                                    fontSize: 18,
                                    color: AppTheme.textSecondary,
                                    fontWeight: FontWeight.w500)),
                            const SizedBox(height: 6),
                            Text(
                                'Tap "Add Receipt / Note" above to capture documents.',
                                style: GoogleFonts.outfit(
                                    fontSize: 14,
                                    color: AppTheme.textSecondary
                                        .withOpacity(0.6))),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 8),
                        itemCount: docs.length,
                        itemBuilder: (context, index) {
                          final doc = docs[index];
                          final isDecrypted = _decryptedStates[doc.id] ?? false;
                          final contentText = isDecrypted
                              ? CryptoService.decryptText(
                                  doc.encryptedContent, widget.unlockedPin)
                              : '🔒 Encrypted Ciphertext (AES-256 CBC)\n${doc.encryptedContent.length > 40 ? "${doc.encryptedContent.substring(0, 40)}..." : doc.encryptedContent}';

                          return GlassCard(
                            margin: const EdgeInsets.only(bottom: 14),
                            padding: const EdgeInsets.all(18),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          doc.type == 'receipt'
                                              ? Icons.receipt_long_rounded
                                              : Icons.description_rounded,
                                          color: AppTheme.accentCyan,
                                          size: 22,
                                        ),
                                        const SizedBox(width: 10),
                                        Text(doc.title,
                                            style: GoogleFonts.outfit(
                                                fontSize: 18,
                                                fontWeight: FontWeight.bold,
                                                color: AppTheme.textPrimary)),
                                      ],
                                    ),
                                    Row(
                                      children: [
                                        if ((doc.amount ?? 0) > 0)
                                          Container(
                                            margin:
                                                const EdgeInsets.only(right: 8),
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                                color: AppTheme.accentEmerald
                                                    .withOpacity(0.15),
                                                borderRadius:
                                                    BorderRadius.circular(8)),
                                            child: Text(
                                                '\$${doc.amount!.toStringAsFixed(2)}',
                                                style: GoogleFonts.outfit(
                                                    color:
                                                        AppTheme.accentEmerald,
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 13)),
                                          ),
                                        IconButton(
                                          icon: const Icon(Icons.delete_outline,
                                              color: AppTheme.textSecondary,
                                              size: 20),
                                          onPressed: () =>
                                              provider.deleteDocument(
                                                  doc.id!, widget.tab.uuid),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),

                                // CONTENT DISPLAY BOX
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: AppTheme.backgroundDark
                                        .withOpacity(0.6),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                        color: isDecrypted
                                            ? AppTheme.accentCyan
                                                .withOpacity(0.5)
                                            : AppTheme.glassBorder),
                                  ),
                                  child: Text(
                                    contentText,
                                    style: GoogleFonts.outfit(
                                      color: isDecrypted
                                          ? AppTheme.textPrimary
                                          : AppTheme.textSecondary
                                              .withOpacity(0.7),
                                      fontSize: 14,
                                    ).copyWith(
                                        fontFamily:
                                            isDecrypted ? null : 'Courier'),
                                  ),
                                ),
                                const SizedBox(height: 12),

                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      doc.createdAt.length >= 10
                                          ? doc.createdAt.substring(0, 10)
                                          : doc.createdAt,
                                      style: GoogleFonts.outfit(
                                          color: AppTheme.textSecondary,
                                          fontSize: 12),
                                    ),
                                    TextButton.icon(
                                      icon: Icon(
                                          isDecrypted
                                              ? Icons
                                                  .enhanced_encryption_rounded
                                              : Icons.lock_open_rounded,
                                          size: 16,
                                          color: AppTheme.accentCyan),
                                      label: Text(
                                        isDecrypted
                                            ? 'Hide Decrypted'
                                            : 'Decrypt Content',
                                        style: GoogleFonts.outfit(
                                            color: AppTheme.accentCyan,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 14),
                                      ),
                                      onPressed: () => _toggleDecrypt(doc.id),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
