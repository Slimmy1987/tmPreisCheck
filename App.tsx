
import React, { useState, useMemo, useEffect } from 'react';
import { Supplier, ComparisonData, PriceEntry, ProductMapping, MasterProduct } from './types';
import { extractPricesFromDocument } from './services/geminiService';
import { 
  auth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  syncUserCollection, 
  updateUserFirestore 
} from './services/firebase';

// Komponente für das tmPreisCheck Logo
const Logo: React.FC<{ light?: boolean }> = ({ light = false }) => (
  <div className="flex items-center select-none scale-90 origin-left">
    <div className={`relative px-4 py-1.5 rounded-2xl flex items-baseline shadow-lg border border-white/10 ${light ? 'bg-slate-100' : 'bg-slate-800'}`}>
      <span className="text-2xl font-black text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] tracking-tighter italic mr-1">tm</span>
      <span className="text-3xl font-black text-orange-500 drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] z-10">P</span>
      <span className={`text-2xl font-bold tracking-tight ${light ? 'text-slate-800' : 'text-white'} drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] -ml-1`}>reisCheck</span>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [comparisonData, setComparisonData] = useState<ComparisonData>({});
  const [mappings, setMappings] = useState<ProductMapping>({});
  const [masterProducts, setMasterProducts] = useState<MasterProduct[]>([]);
  
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [pendingItems, setPendingItems] = useState<{supplierId: string, items: PriceEntry[]} | null>(null);
  const [editingCanonical, setEditingCanonical] = useState<string | null>(null);
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<string | null>(null);

  // Print State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printOptions, setPrintOptions] = useState({
    selectedSuppliers: [] as string[],
    onlyDifferences: true,
    sortBySavings: false,
    groupBySupplier: true,
    showArticleNumbers: false,
    showSavings: true,
    highlightPrices: false
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setSuppliers([]);
      setComparisonData({});
      setMappings({});
      setMasterProducts([]);
      return;
    }

    setIsLoading(true);
    const unsubSuppliers = syncUserCollection(user.uid, 'suppliers', (data) => {
      const list = data || [];
      setSuppliers(list);
      if (list.length > 0 && !selectedSupplierId) setSelectedSupplierId(list[0].id);
      // Initialize print suppliers
      setPrintOptions(prev => ({ ...prev, selectedSuppliers: list.map(s => s.id) }));
    });
    
    const unsubPrices = syncUserCollection(user.uid, 'prices', (data) => setComparisonData(data || {}));
    const unsubMappings = syncUserCollection(user.uid, 'mappings', (data) => setMappings(data || {}));
    const unsubMaster = syncUserCollection(user.uid, 'master_products', (data) => {
      setMasterProducts(data || []);
      setIsLoading(false);
    });

    return () => {
      unsubSuppliers();
      unsubPrices();
      unsubMappings();
      unsubMaster();
    };
  }, [user]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSupplierId || !user) return;
    setIsProcessingFile(true);
    setProcessingProgress(0);
    setError(null);

    const interval = setInterval(() => {
      setProcessingProgress(prev => Math.min(prev + (prev < 50 ? 5 : 1), 95));
    }, 400);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
      });
      const base64 = await base64Promise;
      const extractedItems = await extractPricesFromDocument(base64, file.type);
      clearInterval(interval);
      setProcessingProgress(100);
      setTimeout(() => {
        setPendingItems({ supplierId: selectedSupplierId, items: extractedItems });
        setIsProcessingFile(false);
      }, 500);
    } catch (err) {
      clearInterval(interval);
      setError("Analyse fehlgeschlagen.");
      setIsProcessingFile(false);
    }
  };

  const deleteSupplier = async (id: string) => {
    if (!user) return;
    const next = suppliers.filter(s => s.id !== id);
    try {
      await updateUserFirestore(user.uid, 'suppliers', next);
      if (selectedSupplierId === id) setSelectedSupplierId(next[0]?.id || '');
    } catch (e) { setError("Löschen fehlgeschlagen."); }
  };

  const addSupplier = async () => {
    if (!user || !newSupplierName.trim()) return;
    const id = Date.now().toString();
    const next = [...suppliers, { id, name: newSupplierName.trim() }];
    try {
      await updateUserFirestore(user.uid, 'suppliers', next);
      setNewSupplierName('');
      setSelectedSupplierId(id);
    } catch (e) { setError("Fehler beim Hinzufügen."); }
  };

  const finalizeMappings = async (localToCanonical: Record<string, string>) => {
    if (!user || !pendingItems) return;
    const { supplierId, items } = pendingItems;
    
    const newMappings = { ...mappings };
    const newPrices = { ...comparisonData };
    if (!newPrices[supplierId]) newPrices[supplierId] = {};
    
    const newMaster = [...masterProducts];

    items.forEach(item => {
      const canonical = localToCanonical[item.product] || item.product;
      newMappings[`${supplierId}|${item.product}`] = canonical;
      newPrices[supplierId][item.product] = item.price;
      if (!newMaster.find(p => p.name === canonical)) {
        newMaster.push({ name: canonical, is_favorite: false });
      }
    });

    try {
      await updateUserFirestore(user.uid, 'mappings', newMappings);
      await updateUserFirestore(user.uid, 'prices', newPrices);
      await updateUserFirestore(user.uid, 'master_products', newMaster);
      
      const nextSuppliers = suppliers.map(s => s.id === supplierId ? { ...s, lastUpdate: new Date().toLocaleDateString('de-DE') } : s);
      await updateUserFirestore(user.uid, 'suppliers', nextSuppliers);
      
      setPendingItems(null);
    } catch (e) { 
      setError("Speichern fehlgeschlagen."); 
    }
  };

  const handleMerge = async (targetName: string) => {
    if (!user) return;
    const newMappings = { ...mappings };
    const newMaster = masterProducts.filter(p => !selectedForMerge.has(p.name) || p.name === targetName);
    
    if (!newMaster.find(p => p.name === targetName)) {
      newMaster.push({ name: targetName, is_favorite: false });
    }

    Object.keys(newMappings).forEach(key => {
      if (selectedForMerge.has(newMappings[key])) {
        newMappings[key] = targetName;
      }
    });

    try {
      await updateUserFirestore(user.uid, 'mappings', newMappings);
      await updateUserFirestore(user.uid, 'master_products', newMaster);
      setIsMerging(false);
      setSelectedForMerge(new Set());
    } catch (e) { setError("Fehler beim Verbinden."); }
  };

  const handleManualEntry = async (masterName: string, supplierProdName: string, price: number) => {
    if (!user || !selectedSupplierId) return;
    const newMappings = { ...mappings };
    const newPrices = { ...comparisonData };
    const newMaster = [...masterProducts];

    newMappings[`${selectedSupplierId}|${supplierProdName}`] = masterName;
    if (!newPrices[selectedSupplierId]) newPrices[selectedSupplierId] = {};
    newPrices[selectedSupplierId][supplierProdName] = price;
    
    if (!newMaster.find(p => p.name === masterName)) {
      newMaster.push({ name: masterName, is_favorite: false });
    }

    try {
      await updateUserFirestore(user.uid, 'mappings', newMappings);
      await updateUserFirestore(user.uid, 'prices', newPrices);
      await updateUserFirestore(user.uid, 'master_products', newMaster);
      setIsAddingManual(false);
    } catch (e) { setError("Hinzufügen fehlgeschlagen."); }
  };

  const toggleFavorite = async (name: string) => {
    if (!user) return;
    const next = masterProducts.map(p => p.name === name ? { ...p, is_favorite: !p.is_favorite } : p);
    try {
      await updateUserFirestore(user.uid, 'master_products', next);
    } catch (e) {}
  };

  const getCanonicalPrice = (supplierId: string, canonicalName: string) => {
    const supplierPrices = comparisonData[supplierId];
    if (!supplierPrices) return null;
    const mappingKey = Object.keys(mappings).find(k => k.startsWith(`${supplierId}|`) && mappings[k] === canonicalName);
    if (!mappingKey) return null;
    const supplierProductName = mappingKey.split('|')[1];
    return supplierPrices[supplierProductName] ?? null;
  };

  const filteredAndSortedProducts = useMemo(() => {
    return masterProducts
      .filter(p => p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (a.is_favorite === b.is_favorite ? a.name.localeCompare(b.name) : a.is_favorite ? -1 : 1));
  }, [masterProducts, searchQuery]);

  const checkboxClasses = "w-6 h-6 border-2 border-slate-300 rounded bg-white checked:bg-orange-600 checked:border-orange-600 cursor-pointer transition-all appearance-none relative after:content-[''] after:absolute after:hidden checked:after:block after:left-[7px] after:top-[2px] after:w-[6px] after:h-[12px] after:border-white after:border-b-2 after:border-r-2 after:rotate-45";

  if (authLoading) return <div className="h-screen flex items-center justify-center bg-slate-900 text-white"><i className="fas fa-circle-notch fa-spin text-4xl text-orange-500"></i></div>;
  if (!user) return <AuthScreen />;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50 print:bg-white">
      <aside className="w-full md:w-80 bg-slate-900 text-white p-6 shadow-xl z-10 flex flex-col h-screen sticky top-0 overflow-y-auto no-print">
        <div className="flex items-center justify-between mb-10 shrink-0">
          <Logo />
          <button onClick={() => signOut(auth)} className="text-slate-500 hover:text-red-400 transition-colors" title="Abmelden"><i className="fas fa-sign-out-alt"></i></button>
        </div>

        <div className="flex-1 space-y-8">
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Lieferanten</h2>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                placeholder="Neu..." 
                className="bg-slate-800 border-none rounded-lg px-3 py-2 text-sm w-full outline-none focus:ring-1 focus:ring-orange-500"
                value={newSupplierName}
                onChange={e => setNewSupplierName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSupplier()}
              />
              <button onClick={addSupplier} className="bg-orange-600 px-3 rounded-lg hover:bg-orange-500"><i className="fas fa-plus text-xs"></i></button>
            </div>
            <div className="space-y-2">
              {suppliers.map(s => (
                <div key={s.id} className="group relative">
                  <button onClick={() => setSelectedSupplierId(s.id)} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedSupplierId === s.id ? 'bg-orange-600 text-white shadow-lg' : 'hover:bg-slate-800 text-slate-300'}`}>
                    <span className="font-medium truncate block">{s.name}</span>
                    {s.lastUpdate && <span className="text-[10px] opacity-70">Liste vom: {s.lastUpdate}</span>}
                  </button>
                  <button onClick={() => { if(confirm("Wirklich löschen?")) { deleteSupplier(s.id); } }} className="absolute right-2 top-4 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400"><i className="fas fa-trash text-xs"></i></button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-800 space-y-4">
            <button onClick={() => setIsAddingManual(true)} className="w-full bg-slate-800 hover:bg-slate-700 text-sm font-bold py-3 rounded-xl border border-slate-700 flex items-center justify-center gap-2">
              <i className="fas fa-plus-circle text-orange-400"></i> Einzelner Artikel
            </button>
            <div className="relative">
              <input type="file" accept="application/pdf,image/*" onChange={handleFileUpload} disabled={isProcessingFile || !selectedSupplierId} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <div className="flex flex-col items-center justify-center gap-2 w-full py-4 px-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-orange-500 hover:bg-slate-800 transition-all">
                <div className="flex items-center gap-2">
                  {isProcessingFile ? <i className="fas fa-spinner fa-spin text-orange-400"></i> : <i className="fas fa-file-invoice-dollar text-slate-500"></i>}
                  <span className="text-sm font-bold">{isProcessingFile ? `Analysiere... ${Math.round(processingProgress)}%` : 'Liste aktualisieren (KI)'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-auto pt-4 text-[10px] text-slate-500 truncate">Konto: {user.email}</div>
      </aside>

      <main className="flex-1 p-4 md:p-10 overflow-auto relative">
        <header className="mb-10 space-y-6 print:hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div><h2 className="text-3xl font-extrabold text-slate-800">Preisvergleich</h2><p className="text-slate-500">Ihre gespeicherten Listen & Verknüpfungen.</p></div>
              {selectedForMerge.size >= 2 && (
                <button onClick={() => setIsMerging(true)} className="bg-orange-600 text-white px-6 py-3 rounded-2xl font-black shadow-xl animate-bounce flex items-center gap-2">
                  <i className="fas fa-object-group"></i> Artikel verbinden ({selectedForMerge.size})
                </button>
              )}
            </div>
            <div className="flex flex-1 max-w-md items-center bg-white border rounded-2xl px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-orange-500">
              <i className="fas fa-search text-slate-400 mr-4"></i>
              <input type="text" placeholder="Master-Artikel suchen..." className="w-full outline-none font-semibold bg-white text-slate-800" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <button onClick={() => setIsPrintModalOpen(true)} className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all">
              <i className="fas fa-print"></i> Druckoptionen
            </button>
          </div>
        </header>

        {isLoading ? <div className="text-center py-20"><i className="fas fa-spinner fa-spin text-4xl text-orange-500"></i></div> : (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden print:hidden border border-slate-100">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-6 py-5 w-12 no-print">
                      <input type="checkbox" checked={selectedForMerge.size === filteredAndSortedProducts.length && filteredAndSortedProducts.length > 0} onChange={(e) => {
                        if (e.target.checked) setSelectedForMerge(new Set(filteredAndSortedProducts.map(p => p.name)));
                        else setSelectedForMerge(new Set());
                      }} className={checkboxClasses} />
                    </th>
                    <th className="px-4 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest min-w-[300px]">Master-Bezeichnung</th>
                    {suppliers.map(s => <th key={s.id} className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest text-right">{s.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAndSortedProducts.map(p => {
                    const prices = suppliers.map(s => getCanonicalPrice(s.id, p.name)).filter(x => x !== null) as number[];
                    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                    const isSelected = selectedForMerge.has(p.name);
                    return (
                      <tr key={p.name} className={`hover:bg-slate-50 transition-colors group ${p.is_favorite ? 'bg-amber-50/20' : ''} ${isSelected ? 'bg-orange-50' : ''}`}>
                        <td className="px-6 py-5">
                          <input type="checkbox" checked={isSelected} onChange={() => {
                            const next = new Set(selectedForMerge);
                            if (next.has(p.name)) next.delete(p.name); else next.add(p.name);
                            setSelectedForMerge(next);
                          }} className={checkboxClasses} />
                        </td>
                        <td className="px-4 py-5 font-bold">
                          <div className="flex items-center gap-3">
                            <button onClick={() => toggleFavorite(p.name)} className={`${p.is_favorite ? 'text-amber-400' : 'text-slate-200'} transition-colors no-print`}><i className="fas fa-star"></i></button>
                            <span className="text-slate-700">{p.name}</span>
                          </div>
                        </td>
                        {suppliers.map(s => {
                          const price = getCanonicalPrice(s.id, p.name);
                          const isBest = price !== null && price === minPrice;
                          return <td key={s.id} className="px-8 py-5 text-right">{price !== null ? <span className={`inline-flex px-3 py-1 rounded-xl text-sm font-bold ${isBest ? 'bg-green-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600'}`}>{price.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</span> : <span className="text-slate-200">—</span>}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="hidden print:block print-only w-full">
          <div className="flex justify-between items-start mb-8 border-b-2 border-slate-900 pb-4">
            <div>
              <h1 className="text-2xl font-black">Preisvergleich Report</h1>
              <p className="text-sm text-slate-500">{printOptions.onlyDifferences ? 'Nur Unterschiede' : 'Alle Artikel'} • {printOptions.groupBySupplier ? 'Gruppiert' : 'Matrix'}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-sm">Erstellt: {new Date().toLocaleDateString('de-DE')} {new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
          </div>

          {printOptions.groupBySupplier ? (
            <div className="space-y-10">
              {suppliers.filter(s => printOptions.selectedSuppliers.includes(s.id)).map(s => {
                const supplierProducts = masterProducts.filter(p => {
                  const price = getCanonicalPrice(s.id, p.name);
                  if (price === null) return false;
                  if (printOptions.onlyDifferences) {
                    const allPrices = suppliers.filter(sub => printOptions.selectedSuppliers.includes(sub.id)).map(sub => getCanonicalPrice(sub.id, p.name)).filter(x => x !== null);
                    return allPrices.length > 1 && Math.max(...allPrices) !== Math.min(...allPrices);
                  }
                  return true;
                });

                if (supplierProducts.length === 0) return null;

                const total = supplierProducts.reduce((sum, p) => sum + (getCanonicalPrice(s.id, p.name) || 0), 0);
                const savingsTotal = supplierProducts.reduce((sum, p) => {
                  const myPrice = getCanonicalPrice(s.id, p.name);
                  const allPrices = suppliers.filter(sub => printOptions.selectedSuppliers.includes(sub.id)).map(sub => getCanonicalPrice(sub.id, p.name)).filter(x => x !== null);
                  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : (myPrice || 0);
                  return sum + (maxPrice - (myPrice || 0));
                }, 0);

                return (
                  <div key={s.id} className="break-inside-avoid">
                    <div className="flex justify-between items-end border-b pb-1 mb-3">
                      <h2 className="text-lg font-black uppercase tracking-tight">{s.name} <span className="text-xs text-slate-400 font-normal">({supplierProducts.length} Artikel)</span></h2>
                      <div className="text-right">
                        <span className="text-sm font-bold">Summe: {total.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</span>
                        {printOptions.showSavings && <span className="ml-4 text-sm text-green-600 font-bold">-{savingsTotal.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</span>}
                      </div>
                    </div>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-slate-50">
                          <th className="p-2 text-left text-xs font-bold uppercase">Artikel</th>
                          <th className="p-2 text-right text-xs font-bold uppercase">Preis</th>
                          {printOptions.showSavings && <th className="p-2 text-right text-xs font-bold uppercase">Ersparnis</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {supplierProducts.map(p => {
                          const myPrice = getCanonicalPrice(s.id, p.name);
                          const allPrices = suppliers.filter(sub => printOptions.selectedSuppliers.includes(sub.id)).map(sub => getCanonicalPrice(sub.id, p.name)).filter(x => x !== null);
                          const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : (myPrice || 0);
                          const saving = maxPrice - (myPrice || 0);
                          return (
                            <tr key={p.name} className="border-b">
                              <td className="p-2 text-sm">{p.name}</td>
                              <td className="p-2 text-sm text-right font-bold">{myPrice?.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</td>
                              {printOptions.showSavings && <td className="p-2 text-sm text-right text-green-600 font-bold">{saving > 0 ? `-${saving.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}` : '-'}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 bg-slate-50">
                  <th className="p-2 text-left text-xs font-bold uppercase">Artikel</th>
                  {suppliers.filter(s => printOptions.selectedSuppliers.includes(s.id)).map(s => (
                    <th key={s.id} className="p-2 text-right text-xs font-bold uppercase">{s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {masterProducts.filter(p => {
                   if (printOptions.onlyDifferences) {
                     const allPrices = suppliers.filter(s => printOptions.selectedSuppliers.includes(s.id)).map(s => getCanonicalPrice(s.id, p.name)).filter(x => x !== null);
                     return allPrices.length > 1 && Math.max(...allPrices) !== Math.min(...allPrices);
                   }
                   return true;
                }).map(p => {
                   const pricesForMin = suppliers.filter(s => printOptions.selectedSuppliers.includes(s.id)).map(s => getCanonicalPrice(s.id, p.name)).filter(x => x !== null);
                   const minPrice = pricesForMin.length > 0 ? Math.min(...pricesForMin) : null;
                   return (
                     <tr key={p.name} className="border-b">
                       <td className="p-2 text-sm font-medium">{p.name}</td>
                       {suppliers.filter(s => printOptions.selectedSuppliers.includes(s.id)).map(s => {
                         const price = getCanonicalPrice(s.id, p.name);
                         const isBest = price !== null && price === minPrice;
                         return (
                           <td key={s.id} className={`p-2 text-sm text-right ${isBest && printOptions.highlightPrices ? 'bg-green-50 font-black text-green-700' : ''}`}>
                             {price?.toLocaleString('de-DE', {style:'currency', currency:'EUR'}) || '-'}
                           </td>
                         );
                       })}
                     </tr>
                   );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* --- MODALS --- */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-[2rem] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <i className="fas fa-print text-xl text-slate-800"></i>
                <div>
                  <h3 className="text-xl font-black text-slate-800">Druckoptionen</h3>
                  <p className="text-sm text-slate-500">Passen Sie den Filter, die Auswahl und das Layout an.</p>
                </div>
              </div>
              <button onClick={() => setIsPrintModalOpen(false)} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times text-xl"></i></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div>
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <input type="checkbox" checked={printOptions.selectedSuppliers.length === suppliers.length} onChange={(e) => setPrintOptions(p => ({ ...p, selectedSuppliers: e.target.checked ? suppliers.map(s => s.id) : [] }))} className="w-4 h-4 accent-orange-600" /> Lieferanten auswählen
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {suppliers.map(s => (
                    <label key={s.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer border border-transparent hover:border-slate-200 transition-all">
                      <input type="checkbox" checked={printOptions.selectedSuppliers.includes(s.id)} onChange={() => {
                        const next = printOptions.selectedSuppliers.includes(s.id) 
                          ? printOptions.selectedSuppliers.filter(id => id !== s.id)
                          : [...printOptions.selectedSuppliers, s.id];
                        setPrintOptions(p => ({ ...p, selectedSuppliers: next }));
                      }} className="w-4 h-4 accent-orange-600" />
                      <span className="text-sm font-bold text-slate-700">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Filter & Sortierung</h4>
                <label className="flex items-start gap-4 cursor-pointer group">
                  <input type="checkbox" checked={printOptions.onlyDifferences} onChange={e => setPrintOptions(p => ({ ...p, onlyDifferences: e.target.checked }))} className="w-5 h-5 mt-1 accent-orange-600" />
                  <div>
                    <span className="block text-sm font-bold text-slate-800 group-hover:text-orange-600 transition-colors">Nur Unterschiede drucken</span>
                    <p className="text-xs text-slate-400">Favoriten werden immer gedruckt, auch wenn sie nur bei einem Lieferanten verfügbar sind.</p>
                  </div>
                </label>
                <label className="flex items-center gap-4 cursor-pointer group">
                  <input type="checkbox" checked={printOptions.sortBySavings} onChange={e => setPrintOptions(p => ({ ...p, sortBySavings: e.target.checked }))} className="w-5 h-5 accent-orange-600" />
                  <span className="text-sm font-bold text-slate-800 group-hover:text-orange-600 transition-colors">Nach höchster Ersparnis sortieren</span>
                </label>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Layout</h4>
                <label className="flex items-center gap-4 cursor-pointer p-4 bg-slate-50 rounded-2xl border-2 border-transparent checked-within:border-orange-500 transition-all group">
                  <input type="checkbox" checked={printOptions.groupBySupplier} onChange={e => setPrintOptions(p => ({ ...p, groupBySupplier: e.target.checked }))} className="w-5 h-5 accent-orange-600" />
                  <div className="flex items-center gap-3">
                    <i className="fas fa-list-ul text-slate-400"></i>
                    <div>
                      <span className="block text-sm font-bold text-slate-800">Nach Lieferant gruppieren</span>
                      <p className="text-[10px] text-slate-400">Erstellt Einkaufslisten pro Lieferant (empfohlen).</p>
                    </div>
                  </div>
                </label>
                <div className="grid grid-cols-2 gap-4 ml-9">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={printOptions.showArticleNumbers} onChange={e => setPrintOptions(p => ({ ...p, showArticleNumbers: e.target.checked }))} className="w-4 h-4 accent-orange-600" />
                    <span className="text-xs font-bold text-slate-600">Artikelnummern anzeigen</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={printOptions.showSavings} onChange={e => setPrintOptions(p => ({ ...p, showSavings: e.target.checked }))} className="w-4 h-4 accent-orange-600" />
                    <span className="text-xs font-bold text-slate-600">Ersparnis anzeigen</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer opacity-50 grayscale">
                    <input type="checkbox" checked={printOptions.highlightPrices} disabled onChange={e => setPrintOptions(p => ({ ...p, highlightPrices: e.target.checked }))} className="w-4 h-4 accent-orange-600" />
                    <span className="text-xs font-bold text-slate-400">Preise hervorheben (nur Matrix-Ansicht)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="p-8 border-t bg-slate-50 flex gap-4">
              <button onClick={() => setIsPrintModalOpen(false)} className="flex-1 font-bold text-slate-500 bg-white border border-slate-200 py-3 rounded-xl hover:bg-slate-50 transition-all">Abbrechen</button>
              <button onClick={() => { setIsPrintModalOpen(false); setTimeout(() => window.print(), 300); }} className="flex-[2] bg-slate-900 text-white font-black py-3 rounded-xl shadow-xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all">
                <i className="fas fa-print"></i> Drucken
              </button>
            </div>
          </div>
        </div>
      )}

      {isMerging && <MergeModal options={Array.from(selectedForMerge)} onCancel={() => setIsMerging(false)} onConfirm={handleMerge} />}
      {viewingDetail && <ProductDetailModal masterName={viewingDetail} suppliers={suppliers} mappings={mappings} comparisonData={comparisonData} onClose={() => setViewingDetail(null)} />}
      {isAddingManual && <ManualEntryModal masterProducts={masterProducts} onCancel={() => setIsAddingManual(false)} onConfirm={handleManualEntry} />}
      {pendingItems && <MappingReviewModal pendingItems={pendingItems} suppliers={suppliers} canonicalProducts={masterProducts.map(p => p.name)} mappings={mappings} onCancel={() => setPendingItems(null)} onConfirm={finalizeMappings} />}
    </div>
  );
};

const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { if (isLogin) await signInWithEmailAndPassword(auth, email, password); else await createUserWithEmailAndPassword(auth, email, password); } catch (err: any) { setError("Login fehlgeschlagen."); } finally { setLoading(false); }
  };
  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-900 p-4">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-10 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-orange-600"></div>
        <div className="text-center mb-8">
          <Logo light />
          <p className="text-slate-500 font-medium mt-2">Bitte melden Sie sich an, um fortzufahren</p>
        </div>
        <form onSubmit={handleAuth} className="space-y-4">
          <input type="email" placeholder="Email" required className="w-full bg-slate-50 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500 font-semibold" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Passwort" required className="w-full bg-slate-50 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500 font-semibold" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-xs font-bold text-center">{error}</p>}
          <button disabled={loading} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-lg">{loading ? <i className="fas fa-spinner fa-spin"></i> : (isLogin ? 'Anmelden' : 'Registrieren')}</button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-6 text-slate-400 text-sm font-bold">{isLogin ? 'Konto erstellen' : 'Zum Login'}</button>
      </div>
    </div>
  );
};

const MergeModal: React.FC<any> = ({ options, onCancel, onConfirm }) => {
  const [name, setName] = useState(options[0]);
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] p-10 w-full max-w-lg shadow-2xl">
        <div className="text-center mb-8"><h3 className="text-2xl font-black">Artikel verbinden</h3></div>
        <input list="m-opts" className="w-full bg-slate-50 p-4 rounded-xl outline-none font-bold" value={name} onChange={e=>setName(e.target.value)} />
        <datalist id="m-opts">{options.map((o:string) => <option key={o} value={o}/>)}</datalist>
        <div className="mt-8 flex gap-4"><button onClick={onCancel} className="flex-1 font-bold text-slate-400">Abbrechen</button><button onClick={()=>onConfirm(name)} className="flex-[2] bg-slate-900 text-white py-3 rounded-xl font-bold">Verbinden</button></div>
      </div>
    </div>
  );
};

const ProductDetailModal: React.FC<any> = ({ masterName, suppliers, mappings, comparisonData, onClose }) => {
  const descriptionMap = useMemo(() => {
    const res: Record<string, string[]> = {};
    Object.keys(mappings).forEach(key => { if (mappings[key] === masterName) { const [sId, pName] = key.split('|'); const s = suppliers.find((s:any)=>s.id===sId); if(s) { if(!res[s.name]) res[s.name]=[]; res[s.name].push(pName); } } });
    return res;
  }, [masterName, mappings, suppliers]);
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-xl shadow-2xl overflow-hidden p-8">
        <h3 className="text-2xl font-black mb-6">{masterName}</h3>
        <div className="space-y-4 max-h-[50vh] overflow-y-auto">
          {Object.entries(descriptionMap).map(([sName, items]) => (
            <div key={sName} className="p-4 bg-slate-50 rounded-xl">
              <span className="text-xs font-black text-orange-600 uppercase">{sName}</span>
              {items.map(item => <div key={item} className="font-bold">{item}</div>)}
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-8 w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Schließen</button>
      </div>
    </div>
  );
};

const ManualEntryModal: React.FC<any> = ({ masterProducts, onCancel, onConfirm }) => {
  const [m, setM] = useState(''); const [s, setS] = useState(''); const [p, setP] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold mb-6">Artikel hinzufügen</h3>
        <input list="m-list" placeholder="Master-Name" className="w-full bg-slate-50 p-4 rounded-xl mb-4" value={m} onChange={e=>setM(e.target.value)} />
        <datalist id="m-list">{masterProducts.map((x:any)=><option key={x.name} value={x.name}/>)}</datalist>
        <input placeholder="Lieferanten-Name" className="w-full bg-slate-50 p-4 rounded-xl mb-4" value={s} onChange={e=>setS(e.target.value)} />
        <input type="number" placeholder="Preis (€)" className="w-full bg-slate-50 p-4 rounded-xl mb-8" value={p} onChange={e=>setP(e.target.value)} />
        <div className="flex gap-4"><button onClick={onCancel} className="flex-1 text-slate-400">Abbrechen</button><button onClick={()=>onConfirm(m, s||m, parseFloat(p))} className="flex-[2] bg-orange-600 text-white py-3 rounded-xl font-bold">Speichern</button></div>
      </div>
    </div>
  );
};

const MappingReviewModal: React.FC<any> = ({ pendingItems, suppliers, canonicalProducts, mappings, onCancel, onConfirm }) => {
  const [lm, setLm] = useState<any>(() => {
    const init: any = {};
    pendingItems.items.forEach((i: any) => { init[i.product] = mappings[`${pendingItems.supplierId}|${i.product}`] || ""; });
    return init;
  });
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl p-8">
        <h2 className="text-2xl font-black mb-6">Review der extrahierten Liste</h2>
        <div className="flex-1 overflow-y-auto space-y-2">
          {pendingItems.items.map((i: any, idx: number) => (
            <div key={idx} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl">
              <div className="flex-1 font-bold text-sm truncate">{i.product}</div>
              <div className="w-24 text-right font-black text-orange-600">{i.price.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</div>
              <select className="flex-1 bg-white border p-2 rounded-lg text-xs" value={lm[i.product]} onChange={e => setLm({...lm, [i.product]: e.target.value})}>
                <option value="">+ Neu anlegen</option>
                {canonicalProducts.map((p:string) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-8 flex justify-end gap-4"><button onClick={onCancel}>Abbrechen</button><button onClick={() => onConfirm(lm)} className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold">Speichern</button></div>
      </div>
    </div>
  );
};

export default App;
