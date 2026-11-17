/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { api, setAccountBlockedHandler } from './api';
import type {
  BillItem,
  Category,
  Customer,
  InventoryItem,
  PageKey,
  PharmacyAlerts,
  Prescription,
  ReportsData,
  SiteSettings,
  Supplier,
  User,
} from './types';
import { hasPermission } from './types';
import { LoginView } from './components/LoginView';
import { Layout } from './components/Layout';
import { ErrorPopupModal } from './components/ErrorPopupModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { useKeyboardShortcuts } from './utils/useKeyboardShortcuts';
import { showErrorPopup } from './lib/errorPopup';
import { DashboardCategories } from './pages/DashboardCategories';
import { InventoriesPage } from './pages/InventoriesPage';
import { AddMedicinePage } from './pages/AddMedicinePage';
import { ManageCategoriesPage } from './pages/ManageCategoriesPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { BillingPage } from './pages/BillingPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { CustomersPrescriptionsPage } from './pages/CustomersPrescriptionsPage';
import { AccountingPage } from './pages/AccountingPage';
import { StaffHrPage } from './pages/StaffHrPage';
import { UsersPage } from './pages/UsersPage';
import { ProfileSettingsPage } from './pages/ProfileSettingsPage';
import { EnterpriseModulesPage } from './pages/EnterpriseModulesPage';
import { DeveloperTenantsPage } from './pages/DeveloperTenantsPage';

function pickDefaultPage(u: User): PageKey {
  if (hasPermission(u, 'viewDashboard')) return 'dashboard';
  if (hasPermission(u, 'posBilling')) return 'billing';
  if (hasPermission(u, 'viewInventories')) return 'inventories';
  if (hasPermission(u, 'manageWarehouses')) return 'warehouses';
  if (hasPermission(u, 'managePurchases')) return 'purchases';
  if (hasPermission(u, 'manageCustomers') || hasPermission(u, 'managePrescriptions')) return 'customers';
  if (hasPermission(u, 'manageAccounting')) return 'accounting';
  if (hasPermission(u, 'manageHr')) return 'hr';
  if (hasPermission(u, 'viewReports')) return 'reports';
  if (hasPermission(u, 'manageSuppliers')) return 'suppliers';
  if (hasPermission(u, 'manageUsers')) return 'users';
  return 'profile';
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [blockedMeta, setBlockedMeta] = useState<{ licenseExpired?: boolean; licenseExpiresAt?: string }>({});
  const [site, setSite] = useState<SiteSettings>({
    id: 1,
    title: 'نظام ادارة الصيدلية المتكامل',
    name: 'صيدلية الشفاء الحديثة',
    currencyCode: 'SAR',
    currencySymbol: 'ر.س',
    currencyName: 'ريال سعودي',
  });
  const [bill, setBill] = useState<BillItem[]>([]);
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [reportsTab, setReportsTab] = useState<'sales' | 'purchases' | 'profit' | 'inventory' | 'alerts' | 'audit'>(
    'sales',
  );
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [initialPrescriptionId, setInitialPrescriptionId] = useState<number | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  useKeyboardShortcuts({
    onNavigate: (page) => {
      if (page === 'inventories') setSelectedCatId(null);
      if (page === 'reports') setReportsTab('sales');
      setActivePage(page);
    },
    onToggleHelp: () => setShortcutsModalOpen((v) => !v),
    isSuspended: !user,
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [inventories, setInventories] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [alerts, setAlerts] = useState<PharmacyAlerts | null>(null);

  const refreshCategories = useCallback(async () => {
    const res = await api.getCategories();
    setCategories(res.categories);
  }, []);

  const refreshInventories = useCallback(async () => {
    const res = await api.getInventories(null);
    setInventories(res.inventories);
  }, []);

  const refreshSuppliers = useCallback(async () => {
    const res = await api.getSuppliers();
    setSuppliers(res.suppliers);
  }, []);

  const refreshCustomers = useCallback(async () => {
    const res = await api.getCustomers();
    setCustomers(res.customers);
  }, []);

  const refreshPrescriptions = useCallback(async () => {
    const res = await api.getPrescriptions();
    setPrescriptions(res.prescriptions);
  }, []);

  const refreshUsers = useCallback(async () => {
    const res = await api.getUsers();
    setUsers(res.users);
  }, []);

  const refreshReports = useCallback(async (from?: string, to?: string, currency?: string) => {
    const res = await api.getReports(from, to, currency);
    setReports(res);
    setAlerts(res.alerts);
  }, []);

  const refreshAlerts = useCallback(async () => {
    const res = await api.getAlerts();
    setAlerts(res);
  }, []);

  const refreshBill = useCallback(async () => {
    const res = await api.getBill();
    setBill(res.bill);
  }, []);

  const loadAllData = useCallback(
    async (u: User) => {
      const tasks: Array<Promise<unknown>> = [refreshCategories(), refreshAlerts(), refreshCustomers()];
      if (hasPermission(u, 'viewInventories') || hasPermission(u, 'posBilling') || hasPermission(u, 'managePurchases')) {
        tasks.push(refreshInventories());
      } else {
        setInventories([]);
      }
      if (hasPermission(u, 'manageSuppliers') || hasPermission(u, 'managePurchases') || hasPermission(u, 'manageAccounting')) {
        tasks.push(refreshSuppliers());
      } else {
        setSuppliers([]);
      }
      if (hasPermission(u, 'managePrescriptions')) {
        tasks.push(refreshPrescriptions());
      } else {
        setPrescriptions([]);
      }
      if (hasPermission(u, 'viewReports')) {
        tasks.push(refreshReports());
      } else {
        setReports(null);
      }
      if (hasPermission(u, 'manageUsers')) {
        tasks.push(refreshUsers());
      } else {
        setUsers([]);
      }
      await Promise.all(tasks);
    },
    [
      refreshCategories,
      refreshAlerts,
      refreshCustomers,
      refreshInventories,
      refreshSuppliers,
      refreshPrescriptions,
      refreshReports,
      refreshUsers,
    ],
  );

  useEffect(() => {
    setAccountBlockedHandler((reason, meta) => {
      setUser(null);
      setBill([]);
      setBlockedMessage(reason);
      setBlockedMeta(meta || {});
    });
    return () => setAccountBlockedHandler(null);
  }, []);

  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      showErrorPopup(event.reason, 'تنفيذ عملية في النظام');
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const boot = await api.bootstrap();
        setSite(boot.site);
        if (boot.blockedReason) {
          setBlockedMessage(boot.blockedReason);
          setBlockedMeta({
            licenseExpired: boot.licenseExpired,
            licenseExpiresAt: boot.licenseExpiresAt,
          });
        }
        if (boot.authenticated && boot.user) {
          setUser(boot.user);
          setBill(boot.bill);
          setActivePage(pickDefaultPage(boot.user));
          await loadAllData(boot.user);
        }
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [loadAllData]);

  useEffect(() => {
    document.title = `${site.title} | ${site.name}`;
  }, [site]);

  const handleLoginSuccess = async (payload: {
    user: User;
    site: SiteSettings;
    bill: BillItem[];
  }) => {
    setBlockedMessage('');
    setBlockedMeta({});
    setSite(payload.site);
    setBill(payload.bill);
    setActivePage(pickDefaultPage(payload.user));
    setReportsTab('sales');
    await loadAllData(payload.user);
    setUser(payload.user);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      showErrorPopup(err, 'تسجيل الخروج');
    } finally {
      setUser(null);
      setBill([]);
      setActivePage('dashboard');
    }
  };

  const handleAddToBill = async (id: number) => {
    try {
      const res = await api.addToBill(id);
      setBill(res.bill);
    } catch (err) {
      showErrorPopup(err, 'إضافة صنف إلى الفاتورة');
      throw err;
    }
  };

  const handleScanBarcode = async (barcode: string) => {
    try {
      const res = await api.scanBarcode(barcode);
      setBill(res.bill);
      return res.addedItem;
    } catch (err) {
      showErrorPopup(err, 'مسح الباركود');
      throw err;
    }
  };

  const handleClearBill = async () => {
    try {
      const res = await api.clearBill();
      setBill(res.bill);
    } catch (err) {
      showErrorPopup(err, 'إفراغ الفاتورة الحالية');
    }
  };

  const handleDispensePrescription = async (rx: Prescription) => {
    try {
      let latestBill = bill;
      for (const item of rx.items) {
        if (item.medicine_id) {
          const res = await api.addToBill(item.medicine_id);
          latestBill = res.bill;
          if (item.qty > 1) {
            const updated = await api.updateBillItem(item.medicine_id, { qty: item.qty });
            latestBill = updated.bill;
          }
        }
      }
      setBill(latestBill);
      setInitialPrescriptionId(rx.id);
      setActivePage('billing');
    } catch (err) {
      showErrorPopup(err, 'صرف وصفة طبية إلى نقطة البيع');
    }
  };

  if (booting) {
    return (
      <>
        <ErrorPopupModal />
        <div className="flex min-h-screen items-center justify-center bg-[#F3F6FA] p-4 text-slate-700">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-[#DCE4F0] bg-white px-8 py-6 text-center shadow-sm">
            <img
              src="/assets/aistudio/7c2a7a8e-5e01-4eeb-80ee-00aa057372e0_d6bfeb4f.png"
              alt="شعار النظام - إتقان سوفت (itQAN Soft)"
              referrerPolicy="no-referrer"
              className="h-16 w-auto object-contain"
            />
            <div className="text-sm font-bold text-[#0B4F9C]">
              جاري تحميل نظام إدارة الصيدلية المتكامل...
            </div>
            <div className="text-xs text-slate-500">إتقان سوفت لتقنية المعلومات · itQAN Soft</div>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <ErrorPopupModal />
        <LoginView
          site={site}
          blockedMessage={blockedMessage}
          blockedLicenseExpired={blockedMeta.licenseExpired}
          blockedLicenseExpiresAt={blockedMeta.licenseExpiresAt}
          onSuccess={handleLoginSuccess}
        />
      </>
    );
  }

  return (
    <>
      <ErrorPopupModal />
      <Layout
        user={user}
        site={site}
        bill={bill}
        activePage={activePage}
        onNavigate={(page) => {
          if (page === 'inventories') setSelectedCatId(null);
          if (page === 'reports') setReportsTab('sales');
          setActivePage(page);
          if (page === 'reports' && hasPermission(user, 'viewReports')) {
            void refreshReports().catch((err) => showErrorPopup(err, 'تحديث التقارير'));
          }
        }}
        onClearBill={handleClearBill}
        onLogout={handleLogout}
        onOpenShortcuts={() => setShortcutsModalOpen(true)}
      >
      <KeyboardShortcutsModal isOpen={shortcutsModalOpen} onClose={() => setShortcutsModalOpen(false)} />
      {activePage === 'dashboard' && hasPermission(user, 'viewDashboard') && (
        <DashboardCategories
          user={user}
          site={site}
          categories={categories}
          inventories={inventories}
          alerts={alerts}
          onRefreshCategories={refreshCategories}
          onSelectCategory={(catId) => {
            if (!hasPermission(user, 'viewInventories')) return;
            setSelectedCatId(catId);
            setActivePage('inventories');
          }}
          onGoInventories={() => {
            if (!hasPermission(user, 'viewInventories')) return;
            setSelectedCatId(null);
            setActivePage('inventories');
          }}
          onGoAlerts={() => {
            if (!hasPermission(user, 'viewReports')) return;
            setReportsTab('alerts');
            setActivePage('reports');
          }}
        />
      )}

      {(activePage === 'systemEvaluation' || activePage === 'enterpriseHub') && (
        <EnterpriseModulesPage
          key={activePage}
          user={user}
          site={site}
          inventories={inventories}
          categories={categories}
          initialTab={activePage === 'systemEvaluation' ? 'evaluation' : 'clinical'}
          onNavigate={(page) => {
            if (page === 'inventories') setSelectedCatId(null);
            setActivePage(page);
          }}
          onDataMutated={async () => {
            await loadAllData(user);
          }}
          onDatabaseRestored={async (restoredSite, restoredUser) => {
            setSite(restoredSite);
            setUser(restoredUser);
            setBill([]);
            await loadAllData(restoredUser);
          }}
        />
      )}

      {activePage === 'inventories' && hasPermission(user, 'viewInventories') && (
        <InventoriesPage
          user={user}
          site={site}
          inventories={inventories}
          categories={categories}
          suppliers={suppliers}
          selectedCatId={selectedCatId}
          onSelectCatId={setSelectedCatId}
          onRefreshInventories={async () => {
            await Promise.all([refreshInventories(), refreshCategories(), refreshAlerts()]);
          }}
          onAddToBill={handleAddToBill}
          onScanBarcode={handleScanBarcode}
          onGoAddNew={() => setActivePage('addnew')}
        />
      )}

      {activePage === 'addnew' && hasPermission(user, 'manageMedicines') && (
        <AddMedicinePage
          site={site}
          categories={categories}
          suppliers={suppliers}
          onSaved={async () => {
            await Promise.all([refreshInventories(), refreshCategories(), refreshAlerts()]);
          }}
          onGoInventories={() => {
            setSelectedCatId(null);
            setActivePage('inventories');
          }}
        />
      )}

      {activePage === 'manageCat' && hasPermission(user, 'manageCategories') && (
        <ManageCategoriesPage
          user={user}
          categories={categories}
          onRefreshCategories={async () => {
            await Promise.all([
              refreshCategories(),
              hasPermission(user, 'viewInventories') ? refreshInventories() : Promise.resolve(),
            ]);
          }}
        />
      )}

      {activePage === 'warehouses' && hasPermission(user, 'manageWarehouses') && (
        <WarehousesPage
          user={user}
          site={site}
          inventories={inventories}
          onInventoryMutated={async () => {
            await Promise.all([refreshInventories(), refreshCategories(), refreshAlerts()]);
          }}
        />
      )}

      {activePage === 'billing' && hasPermission(user, 'posBilling') && (
        <BillingPage
          user={user}
          bill={bill}
          site={site}
          inventories={inventories}
          customers={customers}
          prescriptions={prescriptions}
          recentSales={reports?.sales || []}
          initialPrescriptionId={initialPrescriptionId}
          onClearInitialPrescription={() => setInitialPrescriptionId(null)}
          onUpdateBill={setBill}
          onScanBarcode={handleScanBarcode}
          onClearBill={handleClearBill}
          onCheckoutDone={async () => {
            await Promise.all([
              refreshInventories(),
              refreshCustomers(),
              hasPermission(user, 'managePrescriptions') ? refreshPrescriptions() : Promise.resolve(),
              hasPermission(user, 'viewReports') ? refreshReports() : Promise.resolve(),
              refreshAlerts(),
            ]);
          }}
          onGoInventories={() => {
            if (!hasPermission(user, 'viewInventories')) return;
            setSelectedCatId(null);
            setActivePage('inventories');
          }}
        />
      )}

      {activePage === 'purchases' && hasPermission(user, 'managePurchases') && (
        <PurchasesPage
          user={user}
          site={site}
          inventories={inventories}
          suppliers={suppliers}
          onInventoryMutated={async () => {
            await Promise.all([
              refreshInventories(),
              refreshSuppliers(),
              refreshAlerts(),
              hasPermission(user, 'viewReports') ? refreshReports() : Promise.resolve(),
            ]);
          }}
        />
      )}

      {activePage === 'suppliers' && hasPermission(user, 'manageSuppliers') && (
        <SuppliersPage
          user={user}
          site={site}
          suppliers={suppliers}
          onRefreshSuppliers={refreshSuppliers}
        />
      )}

      {activePage === 'customers' &&
        (hasPermission(user, 'manageCustomers') || hasPermission(user, 'managePrescriptions')) && (
          <CustomersPrescriptionsPage
            user={user}
            site={site}
            inventories={inventories}
            onDispensePrescription={handleDispensePrescription}
            onCustomersChanged={refreshCustomers}
          />
        )}

      {activePage === 'accounting' && hasPermission(user, 'manageAccounting') && (
        <AccountingPage
          site={site}
          suppliers={suppliers}
          customers={customers}
          onDataMutated={async () => {
            await Promise.all([
              refreshCustomers(),
              hasPermission(user, 'manageSuppliers') ? refreshSuppliers() : Promise.resolve(),
            ]);
          }}
        />
      )}

      {(activePage === 'hr' || activePage === 'hrAudit') &&
        (hasPermission(user, 'manageHr') || hasPermission(user, 'viewAuditLog')) && (
          <StaffHrPage
            user={user}
            site={site}
            initialTab={activePage === 'hrAudit' ? 'audit' : 'employees'}
          />
        )}

      {activePage === 'reports' && hasPermission(user, 'viewReports') && (
        <ReportsPage
          key={reportsTab}
          user={user}
          site={site}
          initialTab={reportsTab}
          reports={reports}
          onRefreshReports={refreshReports}
        />
      )}

      {activePage === 'users' && hasPermission(user, 'manageUsers') && (
        <UsersPage
          users={users}
          currentUser={user}
          onRefreshUsers={async () => {
            await refreshUsers();
          }}
          onCurrentUserUpdated={(updatedSelf) => {
            setUser(updatedSelf);
            void loadAllData(updatedSelf);
          }}
        />
      )}

      {(activePage === 'profile' || activePage === 'accountSetting') && (
        <ProfileSettingsPage
          mode={activePage}
          user={user}
          site={site}
          onUserUpdated={(updated) => {
            setUser(updated);
            if (hasPermission(updated, 'manageUsers')) {
              void refreshUsers();
            }
          }}
          onSiteUpdated={async (updatedSite, convertedPrices) => {
            setSite(updatedSite);
            const tasks: Array<Promise<unknown>> = [];
            if (hasPermission(user, 'viewReports')) {
              tasks.push(refreshReports());
            }
            if (convertedPrices) {
              tasks.push(refreshInventories());
              if (hasPermission(user, 'posBilling')) {
                tasks.push(refreshBill());
              }
            }
            await Promise.all(tasks);
          }}
          onDatabaseRestored={async (restoredSite, restoredUser) => {
            setSite(restoredSite);
            setUser(restoredUser);
            setBill([]);
            await loadAllData(restoredUser);
          }}
        />
      )}

      {(activePage === 'platformTenants' || activePage === 'developerTenants') && (
        <DeveloperTenantsPage
          currentUser={user}
          currentSite={site}
          onSelectTenantScope={async () => {
            try {
              const res = await api.bootstrap();
              setSite(res.site);
              await loadAllData(user);
            } catch (err) {
              showErrorPopup(err, 'تبديل نطاق الصيدلية');
            }
          }}
        />
      )}
    </Layout>
    </>
  );
}
