import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';
import 'package:path_provider/path_provider.dart';
import '../models/user_model.dart';
import '../models/tab_model.dart';
import '../models/document_model.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('ewallet_vault.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    if (kIsWeb) {
      var factory = databaseFactoryFfiWeb;
      return await factory.openDatabase(
        filePath,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: _createDB,
        ),
      );
    }

    final dbPath = await getApplicationDocumentsDirectory();
    final path = join(dbPath.path, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE users (
        uuid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        pinHash TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE tabs (
        uuid TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        budget REAL NOT NULL DEFAULT 0,
        isSensitive INTEGER NOT NULL DEFAULT 0,
        tabPinHash TEXT,
        createdAt TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tabId TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        encryptedContent TEXT NOT NULL,
        amount REAL DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (tabId) REFERENCES tabs (uuid) ON DELETE CASCADE
      )
    ''');
  }

  // --- USER OPERATIONS ---
  Future<int> createUser(UserModel user) async {
    final db = await instance.database;
    return await db.insert('users', user.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<UserModel?> getUser(String uuid) async {
    final db = await instance.database;
    final maps = await db.query('users', where: 'uuid = ?', whereArgs: [uuid]);
    if (maps.isNotEmpty) {
      return UserModel.fromMap(maps.first);
    }
    return null;
  }

  Future<List<UserModel>> getAllUsers() async {
    final db = await instance.database;
    final result = await db.query('users', orderBy: 'createdAt DESC');
    return result.map((json) => UserModel.fromMap(json)).toList();
  }

  // --- TAB OPERATIONS ---
  Future<int> createTab(TabModel tab) async {
    final db = await instance.database;
    return await db.insert('tabs', tab.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<TabModel>> getTabs(String userId) async {
    final db = await instance.database;
    final result = await db.query('tabs', where: 'userId = ?', whereArgs: [userId], orderBy: 'createdAt DESC');
    return result.map((json) => TabModel.fromMap(json)).toList();
  }

  Future<int> deleteTab(String uuid) async {
    final db = await instance.database;
    await db.delete('documents', where: 'tabId = ?', whereArgs: [uuid]);
    return await db.delete('tabs', where: 'uuid = ?', whereArgs: [uuid]);
  }

  // --- DOCUMENT OPERATIONS ---
  Future<int> createDocument(DocumentModel doc) async {
    final db = await instance.database;
    return await db.insert('documents', doc.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<DocumentModel>> getDocumentsByTab(String tabId) async {
    final db = await instance.database;
    final result = await db.query('documents', where: 'tabId = ?', whereArgs: [tabId], orderBy: 'createdAt DESC');
    return result.map((json) => DocumentModel.fromMap(json)).toList();
  }

  Future<int> deleteDocument(String id) async {
    final db = await instance.database;
    return await db.delete('documents', where: 'id = ?', whereArgs: [id]);
  }

  // --- BACKUP & RESTORE ---
  Future<String> exportBackupData() async {
    final db = await instance.database;
    final users = await db.query('users');
    final tabs = await db.query('tabs');
    final docs = await db.query('documents');

    final backup = {
      'version': '1.0',
      'exportedAt': DateTime.now().toIso8601String(),
      'users': users,
      'tabs': tabs,
      'documents': docs,
    };
    return jsonEncode(backup);
  }

  Future<bool> importBackupData(String jsonString) async {
    try {
      final data = jsonDecode(jsonString);
      final db = await instance.database;

      await db.transaction((txn) async {
        await txn.delete('documents');
        await txn.delete('tabs');
        await txn.delete('users');

        if (data['users'] != null) {
          for (var u in (data['users'] as List)) {
            await txn.insert('users', u);
          }
        }
        if (data['tabs'] != null) {
          for (var t in (data['tabs'] as List)) {
            await txn.insert('tabs', t);
          }
        }
        if (data['documents'] != null) {
          for (var d in (data['documents'] as List)) {
            await txn.insert('documents', d);
          }
        }
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}
