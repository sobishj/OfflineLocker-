class DocumentModel {
  final String? id; // SQLite auto-increment or UUID string
  final String tabId;
  final String title;
  final String type; // e.g., 'receipt', 'note', 'id_card', 'photo'
  final String encryptedContent; // Base64 AES ciphertext or file URI
  final double? amount; // For expense calculation in budget
  final String createdAt;

  DocumentModel({
    this.id,
    required this.tabId,
    required this.title,
    required this.type,
    required this.encryptedContent,
    this.amount,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'tabId': tabId,
      'title': title,
      'type': type,
      'encryptedContent': encryptedContent,
      'amount': amount ?? 0.0,
      'createdAt': createdAt,
    };
  }

  factory DocumentModel.fromMap(Map<String, dynamic> map) {
    return DocumentModel(
      id: map['id']?.toString(),
      tabId: map['tabId'] ?? '',
      title: map['title'] ?? '',
      type: map['type'] ?? 'note',
      encryptedContent: map['encryptedContent'] ?? '',
      amount: (map['amount'] ?? 0.0).toDouble(),
      createdAt: map['createdAt'] ?? '',
    );
  }
}
