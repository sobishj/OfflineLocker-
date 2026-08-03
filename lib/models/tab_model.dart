class TabModel {
  final String uuid;
  final String userId;
  final String name;
  final String description;
  final double budget;
  final bool isSensitive;
  final String? tabPinHash;
  final String createdAt;

  TabModel({
    required this.uuid,
    required this.userId,
    required this.name,
    required this.description,
    required this.budget,
    required this.isSensitive,
    this.tabPinHash,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'uuid': uuid,
      'userId': userId,
      'name': name,
      'description': description,
      'budget': budget,
      'isSensitive': isSensitive ? 1 : 0,
      'tabPinHash': tabPinHash,
      'createdAt': createdAt,
    };
  }

  factory TabModel.fromMap(Map<String, dynamic> map) {
    return TabModel(
      uuid: map['uuid'] ?? '',
      userId: map['userId'] ?? '',
      name: map['name'] ?? '',
      description: map['description'] ?? '',
      budget: (map['budget'] ?? 0.0).toDouble(),
      isSensitive: (map['isSensitive'] == 1 || map['isSensitive'] == true),
      tabPinHash: map['tabPinHash'],
      createdAt: map['createdAt'] ?? '',
    );
  }
}
