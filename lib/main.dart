import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/wallet_provider.dart';
import 'theme/app_theme.dart';
import 'screens/auth_screen.dart';
import 'screens/dashboard_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final walletProvider = WalletProvider();
  await walletProvider.checkExistingUsers();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: walletProvider),
      ],
      child: const EWalletApp(),
    ),
  );
}

class EWalletApp extends StatelessWidget {
  const EWalletApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'eWallet Encrypted Vault',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: Consumer<WalletProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading) {
            return const Scaffold(
              body: Center(
                child: CircularProgressIndicator(color: AppTheme.accentCyan),
              ),
            );
          }
          if (provider.isAuthenticated) {
            return const DashboardScreen();
          }
          return const AuthScreen();
        },
      ),
    );
  }
}
