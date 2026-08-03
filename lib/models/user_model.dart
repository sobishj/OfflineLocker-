class UserModel {
  final String uuid;
  final String username;
  final String pinHash;
  final String createdAt;

  UserModel({
    required this.uuid,
    required this.username,
    required this.pinHash,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'uuid': uuid,
      'username': username,
      'pinHash': pinHash,
      'createdAt': createdAt,
    };
  }

  factory UserModel.fromMap(Map<String, dynamic> map) {
    return UserModel(
      uuid: map['uuid'] ?? '',
      username: map['username'] ?? '',
      pinHash: map['pinHash'] ?? '',
      createdAt: map['createdAt'] ?? '',
    );
  }
}
