// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:ewallet_flutter/main.dart';
import 'package:ewallet_flutter/providers/wallet_provider.dart';

void main() {
  testWidgets('EWalletApp smoke test', (WidgetTester tester) async {
    final walletProvider = WalletProvider();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: walletProvider),
        ],
        child: const EWalletApp(),
      ),
    );
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}

