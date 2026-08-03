import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/wallet_provider.dart';
import '../models/tab_model.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/custom_button.dart';
import '../widgets/tab_pin_modal.dart';
import '../widgets/backup_modal.dart';
import 'tab_detail_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  // New Tab Form State
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _descController = TextEditingController();
  final TextEditingController _budgetController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();
  bool _isSensitive = false;
  bool _showCreateForm = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<WalletProvider>(context, listen: false).loadTabs();
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    _budgetController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  void _handleCreateTab() async {
    final provider = Provider.of<WalletProvider>(context, listen: false);
    final budget = double.tryParse(_budgetController.text) ?? 0.0;

    final success = await provider.createTab(
      name: _nameController.text,
      description: _descController.text,
      budget: budget,
      isSensitive: _isSensitive,
      tabPin: _isSensitive ? _pinController.text : null,
    );

    if (success) {
      _nameController.clear();
      _descController.clear();
      _budgetController.clear();
      _pinController.clear();
      setState(() {
        _isSensitive = false;
        _showCreateForm = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('✨ New Vault Tab Created!'),
              backgroundColor: AppTheme.accentEmerald),
        );
      }
    }
  }

  void _openTab(TabModel tab) {
    if (tab.isSensitive) {
      showDialog(
        context: context,
        builder: (_) => TabPinModal(
          tab: tab,
          onSuccess: (verifiedPin) {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) =>
                    TabDetailScreen(tab: tab, unlockedPin: verifiedPin),
              ),
            );
          },
        ),
      );
    } else {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) =>
              TabDetailScreen(tab: tab, unlockedPin: 'default_open_key'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<WalletProvider>(context);
    final user = provider.currentUser;

    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // Calculate totals
    final totalBudget =
        provider.tabs.fold<double>(0.0, (sum, item) => sum + item.budget);

    return Scaffold(
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
              // --- TOP NAVIGATION BAR ---
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 22,
                          backgroundColor:
                              AppTheme.accentIndigo.withOpacity(0.2),
                          child: Text(
                            user.username.isNotEmpty
                                ? user.username[0].toUpperCase()
                                : 'U',
                            style: GoogleFonts.outfit(
                                color: AppTheme.accentCyan,
                                fontWeight: FontWeight.bold,
                                fontSize: 18),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Encrypted Vault',
                                style: GoogleFonts.outfit(
                                    color: AppTheme.textSecondary,
                                    fontSize: 12)),
                            Text('@${user.username}',
                                style: GoogleFonts.outfit(
                                    color: AppTheme.textPrimary,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 18)),
                          ],
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        IconButton(
                          tooltip: 'Backup & Restore Vault',
                          icon: const Icon(Icons.cloud_sync_outlined,
                              color: AppTheme.accentCyan),
                          onPressed: () => showModalBottomSheet(
                            context: context,
                            isScrollControlled: true,
                            backgroundColor: Colors.transparent,
                            builder: (_) => const BackupModal(),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Lock Vault',
                          icon: const Icon(Icons.lock_outline_rounded,
                              color: AppTheme.accentRose),
                          onPressed: () => provider.logout(),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // --- SCROLLABLE CONTENT ---
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  children: [
                    // --- SUMMARY OVERVIEW CARD ---
                    GlassCard(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF312E81), Color(0xFF1E1B4B)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderColor: AppTheme.accentIndigo.withOpacity(0.5),
                      padding: const EdgeInsets.all(22),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('TOTAL ALLOCATED BUDGET',
                                  style: GoogleFonts.outfit(
                                      color: AppTheme.textSecondary,
                                      fontSize: 12,
                                      letterSpacing: 1.5)),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                    color:
                                        AppTheme.accentEmerald.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(20)),
                                child: Row(
                                  children: [
                                    const Icon(Icons.verified_user_rounded,
                                        size: 12,
                                        color: AppTheme.accentEmerald),
                                    const SizedBox(width: 4),
                                    Text('AES-256 Active',
                                        style: GoogleFonts.outfit(
                                            color: AppTheme.accentEmerald,
                                            fontSize: 11,
                                            fontWeight: FontWeight.bold)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text('\$${totalBudget.toStringAsFixed(2)}',
                              style: GoogleFonts.outfit(
                                  fontSize: 34,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.textPrimary)),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              const Icon(Icons.folder_shared_outlined,
                                  size: 16, color: AppTheme.textSecondary),
                              const SizedBox(width: 6),
                              Text('${provider.tabs.length} Vault Tabs Created',
                                  style: GoogleFonts.outfit(
                                      color: AppTheme.textSecondary,
                                      fontSize: 14)),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // --- NEW TAB BUTTON / FORM ---
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Vault Tabs',
                            style: GoogleFonts.outfit(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.textPrimary)),
                        TextButton.icon(
                          icon: Icon(
                              _showCreateForm
                                  ? Icons.close
                                  : Icons.add_circle_outline,
                              color: AppTheme.accentCyan),
                          label: Text(_showCreateForm ? 'Cancel' : 'New Tab',
                              style: GoogleFonts.outfit(
                                  color: AppTheme.accentCyan,
                                  fontWeight: FontWeight.w600)),
                          onPressed: () => setState(
                              () => _showCreateForm = !_showCreateForm),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    if (_showCreateForm) ...[
                      GlassCard(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('Create New Vault Tab',
                                style: GoogleFonts.outfit(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.textPrimary)),
                            const SizedBox(height: 16),
                            TextField(
                              controller: _nameController,
                              style: GoogleFonts.outfit(fontSize: 16),
                              decoration: const InputDecoration(
                                  labelText:
                                      'Tab Name (e.g. Travel Expenses, Tax Receipts)',
                                  prefixIcon: Icon(Icons.folder_open,
                                      color: AppTheme.accentCyan)),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _descController,
                              style: GoogleFonts.outfit(fontSize: 16),
                              decoration: const InputDecoration(
                                  labelText: 'Description (optional)',
                                  prefixIcon: Icon(Icons.description_outlined,
                                      color: AppTheme.accentCyan)),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _budgetController,
                              keyboardType: TextInputType.number,
                              style: GoogleFonts.outfit(fontSize: 16),
                              decoration: const InputDecoration(
                                  labelText: 'Budget Limit (\$)',
                                  prefixIcon: Icon(Icons.attach_money,
                                      color: AppTheme.accentCyan)),
                            ),
                            const SizedBox(height: 12),
                            SwitchListTile(
                              title: Text('Sensitive Vault Tab',
                                  style: GoogleFonts.outfit(
                                      fontWeight: FontWeight.w600,
                                      color: AppTheme.textPrimary)),
                              subtitle: Text(
                                  'Require a secondary PIN to open & decrypt documents',
                                  style: GoogleFonts.outfit(
                                      fontSize: 12,
                                      color: AppTheme.textSecondary)),
                              value: _isSensitive,
                              activeColor: AppTheme.accentCyan,
                              contentPadding: EdgeInsets.zero,
                              onChanged: (val) =>
                                  setState(() => _isSensitive = val),
                            ),
                            if (_isSensitive) ...[
                              const SizedBox(height: 8),
                              TextField(
                                controller: _pinController,
                                obscureText: true,
                                keyboardType: TextInputType.number,
                                maxLength: 4,
                                style: GoogleFonts.outfit(
                                    fontSize: 18, letterSpacing: 6),
                                decoration: const InputDecoration(
                                    labelText: 'Secondary Tab PIN (4 Digits)',
                                    hintText: '••••',
                                    counterText: '',
                                    prefixIcon: Icon(Icons.key_outlined,
                                        color: AppTheme.accentRose)),
                              ),
                            ],
                            const SizedBox(height: 20),
                            CustomButton(
                              label: 'Save Tab to Vault',
                              icon: Icons.check_circle_outline,
                              onPressed: _handleCreateTab,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                    ],

                    // --- TABS LIST ---
                    if (provider.tabs.isEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 40),
                        child: Center(
                          child: Column(
                            children: [
                              Icon(Icons.folder_off_outlined,
                                  size: 56,
                                  color:
                                      AppTheme.textSecondary.withOpacity(0.4)),
                              const SizedBox(height: 16),
                              Text('No vault tabs found',
                                  style: GoogleFonts.outfit(
                                      fontSize: 18,
                                      color: AppTheme.textSecondary,
                                      fontWeight: FontWeight.w500)),
                              const SizedBox(height: 6),
                              Text(
                                  'Create your first expense or receipt tab above.',
                                  style: GoogleFonts.outfit(
                                      fontSize: 14,
                                      color: AppTheme.textSecondary
                                          .withOpacity(0.6))),
                            ],
                          ),
                        ),
                      ),
                    ] else ...[
                      ...provider.tabs
                          .map((tab) => _buildTabCard(tab, provider)),
                      const SizedBox(height: 40),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTabCard(TabModel tab, WalletProvider provider) {
    return GlassCard(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(18),
      onTap: () => _openTab(tab),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color:
                  (tab.isSensitive ? AppTheme.accentRose : AppTheme.accentCyan)
                      .withOpacity(0.15),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              tab.isSensitive ? Icons.lock_rounded : Icons.folder_rounded,
              color:
                  tab.isSensitive ? AppTheme.accentRose : AppTheme.accentCyan,
              size: 26,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(tab.name,
                        style: GoogleFonts.outfit(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary)),
                    if (tab.isSensitive) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                            color: AppTheme.accentRose.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(6)),
                        child: Text('PIN LOCKED',
                            style: GoogleFonts.outfit(
                                color: AppTheme.accentRose,
                                fontSize: 10,
                                fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(tab.description,
                    style: GoogleFonts.outfit(
                        fontSize: 13, color: AppTheme.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 6),
                Text('Budget Limit: \$${tab.budget.toStringAsFixed(2)}',
                    style: GoogleFonts.outfit(
                        fontSize: 12,
                        color: AppTheme.accentEmerald,
                        fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          IconButton(
            icon:
                const Icon(Icons.delete_outline, color: AppTheme.textSecondary),
            tooltip: 'Delete Tab',
            onPressed: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (_) => AlertDialog(
                  backgroundColor: AppTheme.surfaceDark,
                  title: Text('Delete Vault Tab?',
                      style: GoogleFonts.outfit(color: AppTheme.textPrimary)),
                  content: Text(
                      'Are you sure you want to delete "${tab.name}" and all encrypted documents inside it?',
                      style: GoogleFonts.outfit(color: AppTheme.textSecondary)),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    TextButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: Text('Delete',
                          style: GoogleFonts.outfit(
                              color: AppTheme.accentRose,
                              fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              );
              if (confirm == true) {
                provider.deleteTab(tab.uuid);
              }
            },
          ),
          const Icon(Icons.chevron_right_rounded,
              color: AppTheme.textSecondary),
        ],
      ),
    );
  }
}
