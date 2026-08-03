import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../models/user_model.dart';
import '../models/tab_model.dart';
import '../models/document_model.dart';
import '../services/database_helper.dart';
import '../services/crypto_service.dart';

class WalletProvider extends ChangeNotifier {
  UserModel? _currentUser;
  List<TabModel> _tabs = [];
  List<DocumentModel> _activeDocuments = [];
  bool _isLoading = false;
  String? _errorMessage;

  UserModel? get currentUser => _currentUser;
  List<TabModel> get tabs => _tabs;
  List<DocumentModel> get activeDocuments => _activeDocuments;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get isAuthenticated => _currentUser != null;

  // --- INIT & AUTH ---
  Future<void> checkExistingUsers() async {
    _setLoading(true);
    final users = await DatabaseHelper.instance.getAllUsers();
    if (users.isNotEmpty) {
      // Auto-select first user or prompt login
      _currentUser = users.first;
      await loadTabs();
    }
    _setLoading(false);
  }

  Future<bool> registerUser(String username, String pin) async {
    if (username.trim().isEmpty || pin.trim().length != 4) {
      _errorMessage = 'Please provide a valid username and mandatory 4-digit PIN.';
      notifyListeners();
      return false;
    }
    _setLoading(true);
    final pinHash = CryptoService.hashPin(pin.trim());
    final newUser = UserModel(
      uuid: const Uuid().v4(),
      username: username.trim(),
      pinHash: pinHash,
      createdAt: DateTime.now().toIso8601String(),
    );

    await DatabaseHelper.instance.createUser(newUser);
    _currentUser = newUser;
    _errorMessage = null;
    await loadTabs();
    _setLoading(false);
    return true;
  }

  Future<bool> loginUser(String pin) async {
    if (_currentUser == null) return false;
    final isValid = CryptoService.verifyPin(pin.trim(), _currentUser!.pinHash);
    if (!isValid) {
      _errorMessage = 'Incorrect PIN.';
      notifyListeners();
      return false;
    }
    _errorMessage = null;
    notifyListeners();
    return true;
  }

  void logout() {
    _currentUser = null;
    _tabs.clear();
    _activeDocuments.clear();
    notifyListeners();
  }

  // --- TAB MANAGEMENT ---
  Future<void> loadTabs() async {
    if (_currentUser == null) return;
    _tabs = await DatabaseHelper.instance.getTabs(_currentUser!.uuid);
    notifyListeners();
  }

  Future<bool> createTab({
    required String name,
    required String description,
    required double budget,
    required bool isSensitive,
    String? tabPin,
  }) async {
    if (_currentUser == null) return false;
    if (name.trim().isEmpty) return false;
    if (isSensitive && (tabPin == null || tabPin.trim().length != 4)) {
      _errorMessage = 'Sensitive tabs require a mandatory 4-digit PIN.';
      notifyListeners();
      return false;
    }

    final pinHash = isSensitive && tabPin != null ? CryptoService.hashPin(tabPin.trim()) : null;
    final newTab = TabModel(
      uuid: const Uuid().v4(),
      userId: _currentUser!.uuid,
      name: name.trim(),
      description: description.trim().isEmpty ? 'Custom Vault Tab' : description.trim(),
      budget: budget,
      isSensitive: isSensitive,
      tabPinHash: pinHash,
      createdAt: DateTime.now().toIso8601String(),
    );

    await DatabaseHelper.instance.createTab(newTab);
    await loadTabs();
    return true;
  }

  Future<void> deleteTab(String tabId) async {
    await DatabaseHelper.instance.deleteTab(tabId);
    await loadTabs();
  }

  bool verifyTabPin(TabModel tab, String candidatePin) {
    if (tab.tabPinHash == null) return true;
    return CryptoService.verifyPin(candidatePin.trim(), tab.tabPinHash!);
  }

  // --- DOCUMENT & RECEIPT MANAGEMENT ---
  Future<void> loadDocumentsForTab(String tabId) async {
    _activeDocuments = await DatabaseHelper.instance.getDocumentsByTab(tabId);
    notifyListeners();
  }

  Future<void> addDocument({
    required String tabId,
    required String title,
    required String type,
    required String plainContent,
    double amount = 0.0,
    required String encryptionPin,
  }) async {
    final encrypted = CryptoService.encryptText(plainContent, encryptionPin);
    final doc = DocumentModel(
      tabId: tabId,
      title: title.trim(),
      type: type,
      encryptedContent: encrypted,
      amount: amount,
      createdAt: DateTime.now().toIso8601String(),
    );
    await DatabaseHelper.instance.createDocument(doc);
    await loadDocumentsForTab(tabId);
  }

  Future<void> deleteDocument(String id, String tabId) async {
    await DatabaseHelper.instance.deleteDocument(id);
    await loadDocumentsForTab(tabId);
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }
}
