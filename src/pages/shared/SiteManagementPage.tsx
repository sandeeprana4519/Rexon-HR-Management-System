import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  Briefcase,
  Building2,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  Layers,
  LocateFixed,
  MapPin,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  archiveSiteRecord,
  computeSiteManpowerSummary,
  createSiteRecord,
  createSiteServiceConfig,
  listBranches,
  listClients,
  listDesignations,
  listServices,
  listSites,
  listSiteServiceConfigs,
  removeSiteServiceConfig,
  submitApprovalRequest,
  subscribeMasterData,
  updateSiteRecord,
  updateSiteServiceConfig,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  ClientRecord,
  DesignationRecord,
  INDIAN_STATES,
  SERVICE_CATEGORIES,
  SHIFT_TYPES,
  SITE_STATUSES,
  SITE_TYPES,
  ServiceCategory,
  ServiceRecord,
  SiteFormInput,
  SiteRecord,
  SiteServiceConfigFormInput,
  SiteServiceConfigRecord,
  WEEKLY_OFF_OPTIONS,
  WORKING_HOURS_OPTIONS,
} from '../../types';
import {
  buildGoogleMapsHref,
  computeNonNegativeVacancy,
  validateApprovalSubmission,
  validateSiteForm,
  validateSiteServiceConfigForm,
} from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SiteManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = user?.role === 'admin';
  const canCreateSite = hasUserPermission(user, 'site.create');
  const canEditSite = hasUserPermission(user, 'site.edit');
  const canDeleteSite = hasUserPermission(user, 'site.delete');

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [siteServiceConfigs, setSiteServiceConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [clientFilter, setClientFilter] = useState<string>(
    () => searchParams.get('clientId') || 'ALL'
  );
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // Create / Edit Site Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<SiteRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  // Complete Site Details + Manpower Summary Modal & Archive / Approval Modals
  const [viewingSite, setViewingSite] = useState<SiteRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SiteRecord | null>(null);
  const [archiving, setArchiving] = useState(false);

  // HR Sensitive Site Deletion Approval Request Modal
  const [deleteApprovalSite, setDeleteApprovalSite] = useState<SiteRecord | null>(null);
  const [deleteApprovalReason, setDeleteApprovalReason] = useState('');
  const [deleteApprovalErr, setDeleteApprovalErr] = useState<string | null>(null);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // Site Service Configuration Create/Edit Modal
  const [serviceConfigModalOpen, setServiceConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SiteServiceConfigRecord | null>(null);
  const [configFormError, setConfigFormError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [removeConfigTarget, setRemoveConfigTarget] = useState<SiteServiceConfigRecord | null>(
    null
  );
  const [removingConfig, setRemovingConfig] = useState(false);

  const [configFormData, setConfigFormData] = useState<SiteServiceConfigFormInput>({
    siteId: '',
    siteName: '',
    clientId: '',
    branchId: '',
    serviceCategory: 'Security',
    serviceId: '',
    serviceName: '',
    designationId: '',
    designationName: '',
    requiredCount: 4,
    deployedCount: 0,
    shiftType: 'Day Shift (8h)',
    workingHours: '8 Hours',
    weeklyOff: 'Rotational (1 Day/Week)',
    serviceStartDate: new Date().toISOString().slice(0, 10),
    serviceEndDate: '',
    notes: '',
    status: 'Active',
  });

  const authorizedBranches = useMemo(() => {
    const active = branches.filter((b) => !b.isDeleted);
    if (isAdmin) return active;
    const allowedIds = getAuthorizedBranchIds(user);
    return active.filter((b) => allowedIds.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const selectableClients = useMemo(() => {
    return clients.filter((c) => !c.isArchived);
  }, [clients]);

  const buildEmptySiteForm = useCallback(
    (preselectedClientId?: string): SiteFormInput => {
      const today = new Date().toISOString().slice(0, 10);
      const nextYearDate = new Date();
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
      const nextYear = nextYearDate.toISOString().slice(0, 10);

      const matchedClient =
        selectableClients.find((c) => c.clientId === preselectedClientId) ||
        selectableClients[0] ||
        null;

      return {
        siteName: '',
        clientId: matchedClient?.clientId ?? '',
        clientName: matchedClient?.companyName ?? '',
        branchId:
          matchedClient?.assignedBranch ||
          authorizedBranches[0]?.branchId ||
          getAuthorizedBranchIds(user)[0] ||
          '',
        siteType: 'Factory',
        fullAddress: '',
        city: matchedClient?.city ?? '',
        state: matchedClient?.state ?? 'Maharashtra',
        pinCode: '',
        googleMapsLocation: '',
        siteContactPerson: matchedClient?.contactPerson ?? '',
        siteManagerName: '',
        managerMobile: '',
        managerEmail: '',
        startDate: matchedClient?.contractStartDate || today,
        contractEndDate: matchedClient?.contractEndDate || nextYear,
        siteStatus: 'Active',
        notes: '',
      };
    },
    [selectableClients, authorizedBranches, user]
  );

  const [formData, setFormData] = useState<SiteFormInput>(() => ({
    siteName: '',
    clientId: '',
    clientName: '',
    branchId: '',
    siteType: 'Factory',
    fullAddress: '',
    city: '',
    state: 'Maharashtra',
    pinCode: '',
    googleMapsLocation: '',
    siteContactPerson: '',
    siteManagerName: '',
    managerMobile: '',
    managerEmail: '',
    startDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
    siteStatus: 'Active',
    notes: '',
  }));

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [siteList, clientList, branchList, srvList, dsgList, cfgList] = await Promise.all([
        listSites(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listBranches(user, isPreviewSession),
        listServices(user, isPreviewSession),
        listDesignations(user, isPreviewSession),
        listSiteServiceConfigs(user, isPreviewSession),
      ]);
      setSites(siteList);
      setClients(clientList);
      setBranches(branchList);
      setServices(srvList);
      setDesignations(dsgList);
      setSiteServiceConfigs(cfgList);
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsub = subscribeMasterData(() => {
      void loadData();
    });
    return unsub;
  }, [loadData]);

  // Handle URL query deep-links (?clientId=CLT-...&create=1) from Client Management
  useEffect(() => {
    if (loading) return;
    const qClientId = searchParams.get('clientId');
    const qCreate = searchParams.get('create');

    if (qClientId) {
      setClientFilter(qClientId);
    }

    if (qCreate === '1' && canCreateSite && selectableClients.length > 0) {
      setEditingSite(null);
      setFormData(buildEmptySiteForm(qClientId || undefined));
      setFormError(null);
      setFormModalOpen(true);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('create');
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    loading,
    searchParams,
    canCreateSite,
    selectableClients,
    buildEmptySiteForm,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!viewingSite) return;
    const updated = sites.find((s) => s.siteId === viewingSite.siteId);
    if (updated) {
      setViewingSite(updated);
    }
  }, [sites, viewingSite]);

  const branchMap = useMemo(() => {
    const map: Record<string, BranchRecord> = {};
    for (const b of branches) {
      map[b.branchId] = b;
    }
    return map;
  }, [branches]);

  const configsBySiteId = useMemo(() => {
    const map: Record<string, SiteServiceConfigRecord[]> = {};
    for (const cfg of siteServiceConfigs) {
      if (!map[cfg.siteId]) {
        map[cfg.siteId] = [];
      }
      map[cfg.siteId].push(cfg);
    }
    return map;
  }, [siteServiceConfigs]);

  const viewingSiteConfigs = useMemo(() => {
    if (!viewingSite) return [];
    return configsBySiteId[viewingSite.siteId] ?? [];
  }, [viewingSite, configsBySiteId]);

  const viewingSiteManpower = useMemo(
    () => computeSiteManpowerSummary(viewingSiteConfigs),
    [viewingSiteConfigs]
  );

  // Active authorized Services & Designations filtered for the Service Config Modal
  const availableServicesForCategory = useMemo(() => {
    return services.filter(
      (s) =>
        s.serviceCategory === configFormData.serviceCategory &&
        (s.status === 'Active' || s.serviceId === configFormData.serviceId)
    );
  }, [services, configFormData.serviceCategory, configFormData.serviceId]);

  const availableDesignationsForSelection = useMemo(() => {
    const inCategory = designations.filter(
      (d) =>
        d.serviceCategory === configFormData.serviceCategory &&
        (d.status === 'Active' || d.designationId === configFormData.designationId)
    );
    const exactServiceMatches = inCategory.filter(
      (d) => d.relatedServiceId === configFormData.serviceId
    );
    return exactServiceMatches.length > 0 ? exactServiceMatches : inCategory;
  }, [
    designations,
    configFormData.serviceCategory,
    configFormData.serviceId,
    configFormData.designationId,
  ]);

  const kpis = useMemo(() => {
    const nonArchived = sites.filter((s) => !s.isArchived);
    const active = nonArchived.filter((s) => s.siteStatus === 'Active').length;
    const archivedCount = sites.filter((s) => s.isArchived).length;
    const activeSiteIds = new Set(nonArchived.map((s) => s.siteId));
    const activeSiteConfigs = siteServiceConfigs.filter((c) => activeSiteIds.has(c.siteId));
    const overallManpower = computeSiteManpowerSummary(activeSiteConfigs);

    return {
      total: nonArchived.length,
      active,
      archivedCount,
      totalRequired: overallManpower.totalRequired,
      totalDeployed: overallManpower.totalDeployed,
      totalVacant: overallManpower.totalVacant,
    };
  }, [sites, siteServiceConfigs]);

  const filteredSites = useMemo(() => {
    return sites.filter((s) => {
      if (statusFilter === 'ARCHIVED') {
        if (!s.isArchived) return false;
      } else {
        if (s.isArchived) return false;
        if (statusFilter !== 'ALL' && s.siteStatus !== statusFilter) return false;
      }

      if (clientFilter !== 'ALL' && s.clientId !== clientFilter) return false;
      if (typeFilter !== 'ALL' && s.siteType !== typeFilter) return false;
      if (branchFilter !== 'ALL' && s.branchId !== branchFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        s.siteId.toLowerCase().includes(q) ||
        s.siteName.toLowerCase().includes(q) ||
        s.clientId.toLowerCase().includes(q) ||
        s.clientName.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.pinCode.toLowerCase().includes(q) ||
        s.siteManagerName.toLowerCase().includes(q)
      );
    });
  }, [sites, statusFilter, clientFilter, typeFilter, branchFilter, searchQuery]);

  const paginatedSites = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSites.slice(start, start + pageSize);
  }, [filteredSites, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, clientFilter, typeFilter, branchFilter]);

  const openCreateModal = () => {
    if (selectableClients.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Every Site must belong to an existing Client. Register a Client first before creating a Site.',
      });
      return;
    }
    setEditingSite(null);
    setFormData(buildEmptySiteForm(clientFilter !== 'ALL' ? clientFilter : undefined));
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (site: SiteRecord) => {
    setEditingSite(site);
    setFormData({
      siteName: site.siteName,
      clientId: site.clientId,
      clientName: site.clientName,
      branchId: site.branchId,
      siteType: site.siteType,
      fullAddress: site.fullAddress,
      city: site.city,
      state: site.state,
      pinCode: site.pinCode,
      googleMapsLocation: site.googleMapsLocation,
      siteContactPerson: site.siteContactPerson,
      siteManagerName: site.siteManagerName,
      managerMobile: site.managerMobile,
      managerEmail: site.managerEmail,
      startDate: site.startDate,
      contractEndDate: site.contractEndDate,
      siteStatus: site.siteStatus,
      notes: site.notes,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const openAddServiceConfigModal = (site: SiteRecord) => {
    const defaultCategory: ServiceCategory = 'Security';
    const firstSrv = services.find(
      (s) => s.serviceCategory === defaultCategory && s.status === 'Active'
    );
    const firstDsg =
      designations.find(
        (d) =>
          d.serviceCategory === defaultCategory &&
          d.status === 'Active' &&
          (!firstSrv || d.relatedServiceId === firstSrv.serviceId)
      ) ||
      designations.find((d) => d.serviceCategory === defaultCategory && d.status === 'Active');

    setEditingConfig(null);
    setConfigFormData({
      siteId: site.siteId,
      siteName: site.siteName,
      clientId: site.clientId,
      branchId: site.branchId,
      serviceCategory: defaultCategory,
      serviceId: firstSrv?.serviceId ?? '',
      serviceName: firstSrv?.serviceName ?? '',
      designationId: firstDsg?.designationId ?? '',
      designationName: firstDsg?.designationName ?? '',
      requiredCount: 4,
      deployedCount: 0,
      shiftType: 'Day Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Rotational (1 Day/Week)',
      serviceStartDate: site.startDate || new Date().toISOString().slice(0, 10),
      serviceEndDate: site.contractEndDate || '',
      notes: '',
      status: 'Active',
    });
    setConfigFormError(null);
    setServiceConfigModalOpen(true);
  };

  const openEditServiceConfigModal = (cfg: SiteServiceConfigRecord) => {
    setEditingConfig(cfg);
    setConfigFormData({
      siteId: cfg.siteId,
      siteName: cfg.siteName,
      clientId: cfg.clientId,
      branchId: cfg.branchId,
      serviceCategory: cfg.serviceCategory,
      serviceId: cfg.serviceId,
      serviceName: cfg.serviceName,
      designationId: cfg.designationId,
      designationName: cfg.designationName,
      requiredCount: cfg.requiredCount,
      deployedCount: cfg.deployedCount,
      shiftType: cfg.shiftType,
      workingHours: cfg.workingHours,
      weeklyOff: cfg.weeklyOff,
      serviceStartDate: cfg.serviceStartDate,
      serviceEndDate: cfg.serviceEndDate,
      notes: cfg.notes,
      status: cfg.status,
    });
    setConfigFormError(null);
    setServiceConfigModalOpen(true);
  };

  const handleConfigCategoryChange = (nextCategory: ServiceCategory) => {
    const firstSrv = services.find(
      (s) => s.serviceCategory === nextCategory && s.status === 'Active'
    );
    const firstDsg =
      designations.find(
        (d) =>
          d.serviceCategory === nextCategory &&
          d.status === 'Active' &&
          (!firstSrv || d.relatedServiceId === firstSrv.serviceId)
      ) || designations.find((d) => d.serviceCategory === nextCategory && d.status === 'Active');

    setConfigFormData((prev) => ({
      ...prev,
      serviceCategory: nextCategory,
      serviceId: firstSrv?.serviceId ?? '',
      serviceName: firstSrv?.serviceName ?? '',
      designationId: firstDsg?.designationId ?? '',
      designationName: firstDsg?.designationName ?? '',
    }));
  };

  const handleConfigServiceChange = (srvId: string) => {
    const srv = services.find((s) => s.serviceId === srvId);
    const matchingDsg =
      designations.find(
        (d) => d.relatedServiceId === srvId && d.status === 'Active'
      ) ||
      designations.find(
        (d) => d.serviceCategory === configFormData.serviceCategory && d.status === 'Active'
      );

    setConfigFormData((prev) => ({
      ...prev,
      serviceId: srv?.serviceId ?? '',
      serviceName: srv?.serviceName ?? '',
      designationId: matchingDsg?.designationId ?? '',
      designationName: matchingDsg?.designationName ?? '',
    }));
  };

  const handleSaveServiceConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setConfigFormError(null);

    const validation = validateSiteServiceConfigForm(
      configFormData,
      siteServiceConfigs,
      editingConfig?.siteServiceId
    );
    if (!validation.valid) {
      setConfigFormError(validation.error ?? 'Verify all Site Service Configuration fields.');
      return;
    }

    setSavingConfig(true);
    try {
      if (editingConfig) {
        await updateSiteServiceConfig(
          user,
          isPreviewSession,
          editingConfig.siteServiceId,
          configFormData
        );
        setFeedback({
          type: 'success',
          text: `Updated ${configFormData.serviceCategory} — ${configFormData.designationName} on ${configFormData.siteId}.`,
        });
      } else {
        await createSiteServiceConfig(user, isPreviewSession, configFormData);
        setFeedback({
          type: 'success',
          text: `Added ${configFormData.serviceCategory} — ${configFormData.designationName} to ${configFormData.siteId}.`,
        });
      }
      setServiceConfigModalOpen(false);
      await loadData();
    } catch (err) {
      setConfigFormError(formatServiceErrorMessage(err));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleConfirmRemoveConfig = async () => {
    if (!user || !removeConfigTarget) return;
    setRemovingConfig(true);
    try {
      await removeSiteServiceConfig(user, isPreviewSession, removeConfigTarget.siteServiceId);
      setFeedback({
        type: 'success',
        text: `Removed ${removeConfigTarget.designationName} configuration from ${removeConfigTarget.siteId}.`,
      });
      setRemoveConfigTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setRemoveConfigTarget(null);
    } finally {
      setRemovingConfig(false);
    }
  };

  const handleClientSelectionChange = (selectedClientId: string) => {
    const found = selectableClients.find((c) => c.clientId === selectedClientId);
    if (!found) {
      setFormData((prev) => ({ ...prev, clientId: '', clientName: '' }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      clientId: found.clientId,
      clientName: found.companyName,
      branchId: found.assignedBranch || prev.branchId,
      siteContactPerson: prev.siteContactPerson || found.contactPerson,
      startDate: prev.startDate || found.contractStartDate,
      contractEndDate: prev.contractEndDate || found.contractEndDate,
    }));
  };

  const handleCaptureBrowserGps = () => {
    if (!('geolocation' in navigator)) {
      setFormError(
        'Geolocation is not supported in this browser. Paste a Google Maps link or coordinates manually.'
      );
      return;
    }
    setGpsBusy(true);
    setFormError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        setFormData((prev) => ({ ...prev, googleMapsLocation: coords }));
        setGpsBusy(false);
      },
      () => {
        setFormError(
          'Could not read GPS location automatically. Paste coordinates or a Google Maps link.'
        );
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const validation = validateSiteForm(formData, sites, editingSite?.siteId);
    if (!validation.valid) {
      setFormError(validation.error ?? 'Please review the Site fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingSite) {
        await updateSiteRecord(user, isPreviewSession, editingSite.siteId, formData);
        setFeedback({
          type: 'success',
          text: `Site ${editingSite.siteId} (${formData.siteName}) updated.`,
        });
      } else {
        const created = await createSiteRecord(user, isPreviewSession, formData);
        setFeedback({
          type: 'success',
          text: `Site ${created.siteId} (${created.siteName}) created under Client ${created.clientName}.`,
        });
      }
      setFormModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmArchiveSite = async () => {
    if (!user || !archiveTarget) return;
    setArchiving(true);
    try {
      await archiveSiteRecord(user, isPreviewSession, archiveTarget.siteId);
      setFeedback({
        type: 'success',
        text: `Site ${archiveTarget.siteId} archived. Complete historical deployment and audit records have been preserved.`,
      });
      setArchiveTarget(null);
      if (viewingSite?.siteId === archiveTarget.siteId) {
        setViewingSite(null);
      }
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setArchiving(false);
    }
  };

  const handleSubmitDeleteApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !deleteApprovalSite) return;
    setDeleteApprovalErr(null);

    const payload = {
      requestType: 'Site Deletion' as const,
      module: 'Site' as const,
      targetRecordId: deleteApprovalSite.siteId,
      targetRecordName: deleteApprovalSite.siteName,
      branchId: deleteApprovalSite.branchId,
      summary: `Request archival of Site ${deleteApprovalSite.siteId} (${deleteApprovalSite.siteName})`,
      reason: deleteApprovalReason,
    };

    const check = validateApprovalSubmission(payload);
    if (!check.valid) {
      setDeleteApprovalErr(check.error ?? 'Provide an operational reason (min 8 chars).');
      return;
    }

    setSubmittingApproval(true);
    try {
      const apr = await submitApprovalRequest(user, isPreviewSession, payload);
      setFeedback({
        type: 'success',
        text: `Site deletion request ${apr.approvalId} submitted for Administrator sign-off.`,
      });
      setDeleteApprovalSite(null);
      setDeleteApprovalReason('');
      await loadData();
    } catch (err) {
      setDeleteApprovalErr(formatServiceErrorMessage(err));
    } finally {
      setSubmittingApproval(false);
    }
  };

  const statusTextClass = (site: SiteRecord) => {
    if (site.isArchived) return 'text-[#7D6F65] italic font-medium';
    switch (site.siteStatus) {
      case 'Active':
        return 'text-[#166534] font-semibold';
      case 'Pending':
        return 'text-[#B45309] font-semibold';
      case 'Suspended':
        return 'text-[#B91C1C] font-semibold';
      case 'Inactive':
      default:
        return 'text-[#574B43] font-medium';
    }
  };

  const filterTabOptions = useMemo(() => {
    const base = [
      { value: 'ALL', label: 'All Active Scope' },
      ...SITE_STATUSES.map((st) => ({ value: st, label: st })),
    ];
    if (isAdmin) {
      base.push({ value: 'ARCHIVED', label: `Archived History (${kpis.archivedCount})` });
    }
    return base;
  }, [isAdmin, kpis.archivedCount]);

  const previewConfigVacancy = computeNonNegativeVacancy(
    configFormData.requiredCount,
    configFormData.deployedCount
  );
  const isConfigNegativeAttempt = configFormData.deployedCount > configFormData.requiredCount;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Site Master &amp; Service Configuration
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isAdmin
              ? 'Complete Admin oversight across Client Sites, multi-service manpower configurations (Security, Housekeeping, Manpower), and vacancy tracking.'
              : 'Create Sites under contracted Clients and configure Security, Housekeeping, and Manpower posts within your authorized branch scope.'}
          </p>
        </div>

        {canCreateSite && (
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Site</span>
          </button>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <section aria-label="Site master metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Operational Sites"
            value={kpis.total}
            subtext={`${kpis.active} Active · ${isAdmin ? `${kpis.archivedCount} Archived` : 'Scoped to branch'}`}
            icon={MapPin}
          />
          <StatMetricCard
            label="Total Required Posts"
            value={kpis.totalRequired}
            subtext="Sanctioned Security, HK & Manpower"
            icon={Layers}
          />
          <StatMetricCard
            label="Deployed Personnel"
            value={kpis.totalDeployed}
            subtext="Active headcount across site posts"
            icon={Building2}
          />
          <StatMetricCard
            label="Open Vacant Posts"
            value={kpis.totalVacant}
            subtext="Vacant = Required − Deployed (>= 0)"
            icon={ShieldAlert}
            tone={kpis.totalVacant > 0 ? 'attention' : 'default'}
          />
        </div>
      </section>

      {/* Site Directory Table Card */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Client Site &amp; Multi-Service Registry
            </h2>
            <p className="text-xs text-[#574B43]">
              One Site can run Security, Housekeeping, and Manpower simultaneously. Open any Site to
              inspect or configure service-wise manpower and vacancies.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by Parent Client"
              value={clientFilter}
              onChange={(e) => {
                const val = e.target.value;
                setClientFilter(val);
                const next = new URLSearchParams(searchParams);
                if (val === 'ALL') next.delete('clientId');
                else next.set('clientId', val);
                setSearchParams(next, { replace: true });
              }}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E] max-w-[240px]"
            >
              <option value="ALL">All Clients</option>
              {selectableClients.map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.clientId} — {c.displayName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Site Type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Site Types</option>
              {SITE_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            {authorizedBranches.length > 1 && (
              <select
                aria-label="Filter by Branch"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
              >
                <option value="ALL">All Branches</option>
                {authorizedBranches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchCode} — {b.city}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Site ID, site name, client, manager, city, or PIN..."
          filterOptions={filterTabOptions}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredSites.length === 0 ? (
          <EmptyStatePanel
            icon={MapPin}
            title="No Site Records Found"
            description={
              statusFilter === 'ARCHIVED'
                ? 'No Sites have been archived yet. Soft-deleted sites remain safely stored here for historical reference.'
                : 'Adjust your filters or create a new Site under an existing Client.'
            }
            actionLabel={
              canCreateSite && statusFilter !== 'ARCHIVED' ? 'Create New Site' : undefined
            }
            onAction={canCreateSite && statusFilter !== 'ARCHIVED' ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Site ID</th>
                    <th className="py-3 px-3">Site Name &amp; Client</th>
                    <th className="py-3 px-3">Location &amp; Branch</th>
                    <th className="py-3 px-3">Services &amp; Manpower (Req/Dep/Vac)</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedSites.map((site) => {
                    const branchObj = branchMap[site.branchId];
                    const mapsHref = buildGoogleMapsHref(
                      site.googleMapsLocation,
                      `${site.fullAddress}, ${site.city} ${site.pinCode}`
                    );
                    const siteCfgs = configsBySiteId[site.siteId] ?? [];
                    const mpSummary = computeSiteManpowerSummary(siteCfgs);
                    const activeCats = SERVICE_CATEGORIES.filter(
                      (cat) => mpSummary.byCategory[cat].designationLines > 0
                    );

                    return (
                      <tr
                        key={site.siteId}
                        className="hover:bg-[#FAF8F5] transition-colors align-top"
                      >
                        <td className="py-3.5 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                          <div>{site.siteId}</div>
                          <div className="text-[11px] font-normal text-[#7D6F65] mt-0.5">
                            PIN {site.pinCode}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-[#1F1916]">{site.siteName}</div>
                          <div className="text-xs text-[#574B43] mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-[#1F1916]">{site.clientName}</span>
                            <span>·</span>
                            <span>{site.siteType}</span>
                            <span>·</span>
                            <a
                              href={mapsHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[#5C3D2E] font-medium hover:underline"
                            >
                              <span>Map</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="text-[#1F1916]">
                            {site.city}, {site.state}
                          </div>
                          <div className="font-mono-tabular text-xs text-[#7D6F65] mt-0.5">
                            {branchObj ? branchObj.branchCode : site.branchId} · Mgr:{' '}
                            {site.siteManagerName}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          {mpSummary.totalLines === 0 ? (
                            <span className="text-xs text-[#7D6F65]">
                              No service lines configured yet
                            </span>
                          ) : (
                            <div>
                              <div className="font-mono-tabular text-xs font-semibold text-[#1F1916]">
                                Req {mpSummary.totalRequired} · Dep{' '}
                                <span className="text-[#166534]">{mpSummary.totalDeployed}</span> ·
                                Vac{' '}
                                <span
                                  className={
                                    mpSummary.totalVacant > 0
                                      ? 'text-[#B45309]'
                                      : 'text-[#574B43]'
                                  }
                                >
                                  {mpSummary.totalVacant}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#574B43] mt-0.5">
                                {activeCats.join(' · ')} ({mpSummary.totalLines} post line
                                {mpSummary.totalLines > 1 ? 's' : ''})
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                          <span className={statusTextClass(site)}>
                            {site.isArchived ? 'Archived (History)' : site.siteStatus}
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingSite(site)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                              title="Inspect Site details & Service-wise Manpower Summary"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                              <span>Details &amp; Services</span>
                            </button>

                            {canEditSite && !site.isArchived && (
                              <button
                                type="button"
                                onClick={() => openEditModal(site)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                                title="Edit site metadata"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Edit</span>
                              </button>
                            )}

                            {canDeleteSite && !site.isArchived && (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(site)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2] transition-colors inline-flex items-center gap-1"
                                title="Archive / Soft-Delete Site"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            )}

                            {!canDeleteSite && !isAdmin && !site.isArchived && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteApprovalSite(site);
                                  setDeleteApprovalReason('');
                                  setDeleteApprovalErr(null);
                                }}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-medium text-[#5C3D2E] hover:bg-[#E7DDD0] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                                title="Submit Site Deletion request for Admin approval"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Req Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredSites.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* ===================================================================== */}
      {/* CREATE / EDIT SITE MODAL (ALL 19 SPECIFIED FIELDS)                    */}
      {/* ===================================================================== */}
      {formModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-form-modal-title"
        >
          <div className="w-full max-w-4xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
              <div>
                <h2
                  id="site-form-modal-title"
                  className="font-display text-lg sm:text-xl font-bold text-[#1F1916]"
                >
                  {editingSite ? `Edit Site — ${editingSite.siteId}` : 'Create New Client Site'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Every Site must belong to one Client. Unique Site ID is generated automatically
                  and accidental duplicates are blocked.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                disabled={saving}
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveSite(e)}
              className="p-5 sm:p-6 overflow-y-auto space-y-6"
              noValidate
            >
              {formError && (
                <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Parent Client, Site Identity & Branch */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  1. Parent Client &amp; Site Identity
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site ID (Automatic &amp; Unique)
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={
                        editingSite ? editingSite.siteId : 'Auto-assigned on save (STE-YYYY-XXXX)'
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Parent Client (Client ID &amp; Client Name){' '}
                      <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.clientId}
                      onChange={(e) => handleClientSelectionChange(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Existing Client...</option>
                      {selectableClients.map((c) => (
                        <option key={c.clientId} value={c.clientId}>
                          {c.clientId} — {c.companyName} ({c.city})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site Name <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.siteName}
                      onChange={(e) => setFormData((p) => ({ ...p, siteName: e.target.value }))}
                      placeholder="e.g. Apex Chakan Assembly Plant — Unit 3"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site Type <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.siteType}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          siteType: e.target.value as SiteFormInput['siteType'],
                        }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {SITE_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Client ID (Linked)
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={formData.clientId || '—'}
                      className="w-full min-h-[42px] px-3.5 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Branch ID <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.branchId}
                      onChange={(e) => setFormData((p) => ({ ...p, branchId: e.target.value }))}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Branch...</option>
                      {authorizedBranches.map((b) => (
                        <option key={b.branchId} value={b.branchId}>
                          {b.branchId} ({b.branchCode} — {b.city})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site Status <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.siteStatus}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          siteStatus: e.target.value as SiteFormInput['siteStatus'],
                        }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {SITE_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Address & Google Maps Location */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5DDD2] pb-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E]">
                    2. Physical Address &amp; Google Maps Location
                  </h3>
                  <button
                    type="button"
                    onClick={handleCaptureBrowserGps}
                    disabled={gpsBusy}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5C3D2E] hover:underline disabled:opacity-50"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    <span>{gpsBusy ? 'Capturing GPS...' : 'Use Current GPS Coordinates'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Full Address <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.fullAddress}
                      onChange={(e) => setFormData((p) => ({ ...p, fullAddress: e.target.value }))}
                      placeholder="Gate / Plot / Building / Landmark / Sector"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      City <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))}
                      placeholder="e.g. Pune"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      State <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.state}
                      onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      PIN Code <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={formData.pinCode}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          pinCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                        }))
                      }
                      placeholder="e.g. 410501"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Google Maps Location (Maps URL or Lat, Lng Coordinates)
                    </label>
                    <input
                      type="text"
                      value={formData.googleMapsLocation}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, googleMapsLocation: e.target.value }))
                      }
                      placeholder="e.g. 18.7606, 73.8636 or https://maps.google.com/?q=18.7606,73.8636"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Site Contacts & Site Manager */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  3. Site Contact &amp; Site Manager Details
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site Contact Person <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.siteContactPerson}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, siteContactPerson: e.target.value }))
                      }
                      placeholder="Client representative at site"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Site Manager Name <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.siteManagerName}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, siteManagerName: e.target.value }))
                      }
                      placeholder="Assigned Site / Facility Manager"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Manager Mobile <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.managerMobile}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, managerMobile: e.target.value }))
                      }
                      placeholder="+91 98200 00000"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Manager Email <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.managerEmail}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, managerEmail: e.target.value }))
                      }
                      placeholder="site.manager@client.com"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Deployment Dates & Notes */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  4. Deployment Schedule &amp; Post Notes
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Start Date <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData((p) => ({ ...p, startDate: e.target.value }))}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Contract End Date <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.contractEndDate}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, contractEndDate: e.target.value }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Operational Notes
                    </label>
                    <textarea
                      rows={2}
                      value={formData.notes}
                      onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Shift timings, gate pass verification instructions, patrol checkpoints..."
                      className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  disabled={saving}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {saving
                    ? 'Saving Site...'
                    : editingSite
                      ? 'Save Site Updates'
                      : 'Create Site Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* COMPLETE SITE DETAILS + SERVICE-WISE MANPOWER SUMMARY MODAL           */}
      {/* ===================================================================== */}
      {viewingSite && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-detail-modal-title"
        >
          <div className="w-full max-w-5xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#7D6F65]">
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingSite.siteId}
                  </span>
                  <span>·</span>
                  <span>{viewingSite.siteType}</span>
                  <span>·</span>
                  <span className={statusTextClass(viewingSite)}>
                    {viewingSite.isArchived
                      ? 'Archived (Historical Record)'
                      : viewingSite.siteStatus}
                  </span>
                </div>
                <h2
                  id="site-detail-modal-title"
                  className="mt-1 font-display text-lg sm:text-xl font-bold text-[#1F1916]"
                >
                  {viewingSite.siteName}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setViewingSite(null)}
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close site details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-sm">
              {viewingSite.isArchived && (
                <div className="p-3.5 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023]">
                  <strong>Historical Record Preserved:</strong> Archived on{' '}
                  <span className="font-mono-tabular">
                    {formatIsoDateTime(viewingSite.archivedAt)}
                  </span>{' '}
                  by {viewingSite.archivedBy || 'Administrator'}. Past attendance, deployment, and
                  invoice linkages remain intact.
                </div>
              )}

              {/* =============================================================== */}
              {/* SERVICE-WISE MANPOWER SUMMARY & DESIGNATION CONFIGURATION       */}
              {/* =============================================================== */}
              <div className="border border-[#D4C7B8] rounded-xl p-4 sm:p-5 bg-[#FAF8F5] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#1F1916]">
                      Service-Wise Manpower &amp; Vacancy Summary
                    </h3>
                    <p className="text-xs text-[#574B43]">
                      Configure Security, Housekeeping, and Manpower under one Site.{' '}
                      <span className="font-semibold">Vacant = Required − Deployed</span> (negative
                      vacancy is strictly blocked).
                    </p>
                  </div>

                  {canEditSite && !viewingSite.isArchived && (
                    <button
                      type="button"
                      onClick={() => openAddServiceConfigModal(viewingSite)}
                      className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] inline-flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Configure Service Line</span>
                    </button>
                  )}
                </div>

                {/* Overall + 3 Category Summary Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-white border border-[#E5DDD2] rounded-xl p-3.5">
                    <span className="text-xs font-semibold text-[#5C3D2E] block">
                      All Site Services Total
                    </span>
                    <div className="mt-2 grid grid-cols-3 gap-2 font-mono-tabular text-xs">
                      <div>
                        <span className="text-[11px] text-[#7D6F65] block">Req</span>
                        <span className="text-base font-bold text-[#1F1916]">
                          {viewingSiteManpower.totalRequired}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#7D6F65] block">Dep</span>
                        <span className="text-base font-bold text-[#166534]">
                          {viewingSiteManpower.totalDeployed}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#7D6F65] block">Vac</span>
                        <span
                          className={`text-base font-bold ${
                            viewingSiteManpower.totalVacant > 0
                              ? 'text-[#B45309]'
                              : 'text-[#574B43]'
                          }`}
                        >
                          {viewingSiteManpower.totalVacant}
                        </span>
                      </div>
                    </div>
                  </div>

                  {SERVICE_CATEGORIES.map((cat) => {
                    const catRow = viewingSiteManpower.byCategory[cat];
                    return (
                      <div
                        key={cat}
                        className="bg-white border border-[#E5DDD2] rounded-xl p-3.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#1F1916]">{cat}</span>
                          <span className="font-mono-tabular text-[11px] text-[#7D6F65]">
                            {catRow.designationLines} line(s)
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 font-mono-tabular text-xs">
                          <div>
                            <span className="text-[11px] text-[#7D6F65] block">Req</span>
                            <span className="text-base font-semibold text-[#1F1916]">
                              {catRow.requiredCount}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-[#7D6F65] block">Dep</span>
                            <span className="text-base font-semibold text-[#166534]">
                              {catRow.deployedCount}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-[#7D6F65] block">Vac</span>
                            <span
                              className={`text-base font-semibold ${
                                catRow.vacantCount > 0 ? 'text-[#B45309]' : 'text-[#574B43]'
                              }`}
                            >
                              {catRow.vacantCount}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Configured Designation Lines Table */}
                {viewingSiteConfigs.length === 0 ? (
                  <div className="p-4 rounded-xl bg-white border border-dashed border-[#D4C7B8] text-xs text-[#574B43] text-center">
                    No Security, Housekeeping, or Manpower service lines configured for this Site
                    yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto bg-white border border-[#E5DDD2] rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#F3EDE4] border-b border-[#E5DDD2] font-semibold text-[#574B43]">
                          <th className="py-2.5 px-3">Category &amp; Service</th>
                          <th className="py-2.5 px-3">Designation</th>
                          <th className="py-2.5 px-3">Shift &amp; Schedule</th>
                          <th className="py-2.5 px-3">Contract Window</th>
                          <th className="py-2.5 px-3 text-right">Required</th>
                          <th className="py-2.5 px-3 text-right">Deployed</th>
                          <th className="py-2.5 px-3 text-right">Vacant</th>
                          {canEditSite && !viewingSite.isArchived && (
                            <th className="py-2.5 px-3 text-right">Manage</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5DDD2]">
                        {viewingSiteConfigs.map((cfg) => {
                          const vac = computeNonNegativeVacancy(
                            cfg.requiredCount,
                            cfg.deployedCount
                          );
                          return (
                            <tr key={cfg.siteServiceId} className="hover:bg-[#FAF8F5] align-top">
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-[#5C3D2E]">
                                  {cfg.serviceCategory}
                                </div>
                                <div className="text-[#1F1916]">{cfg.serviceName}</div>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-[#1F1916]">
                                  {cfg.designationName}
                                </div>
                                {cfg.notes && (
                                  <div className="text-[11px] text-[#7D6F65] mt-0.5">
                                    {cfg.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-[#574B43]">
                                <div className="font-medium text-[#1F1916]">{cfg.shiftType}</div>
                                <div>
                                  {cfg.workingHours} · {cfg.weeklyOff}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono-tabular text-[#574B43] whitespace-nowrap">
                                <div>{cfg.serviceStartDate}</div>
                                <div className="text-[#7D6F65]">to {cfg.serviceEndDate}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                                {cfg.requiredCount}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                                {cfg.deployedCount}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-mono-tabular font-semibold ${
                                  vac > 0 ? 'text-[#B45309]' : 'text-[#574B43]'
                                }`}
                              >
                                {vac}
                              </td>
                              {canEditSite && !viewingSite.isArchived && (
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEditServiceConfigModal(cfg)}
                                      className="min-h-[30px] px-2 py-1 rounded border border-[#E5DDD2] bg-[#FAF8F5] text-[#1F1916] hover:bg-[#F3EDE4]"
                                      title="Edit service post line"
                                    >
                                      <Edit3 className="w-3 h-3 text-[#5C3D2E]" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRemoveConfigTarget(cfg)}
                                      className="min-h-[30px] px-2 py-1 rounded border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2]"
                                      title="Remove service post line"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Complete 19-Field Inspection Panel */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4">
                <div>
                  <span className="text-xs text-[#7D6F65] block">Site ID</span>
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingSite.siteId}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Parent Client Name</span>
                  <span className="font-semibold text-[#1F1916]">{viewingSite.clientName}</span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Client ID</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {viewingSite.clientId}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Branch ID</span>
                  <span className="font-mono-tabular font-medium text-[#1F1916]">
                    {viewingSite.branchId}
                    {branchMap[viewingSite.branchId]
                      ? ` (${branchMap[viewingSite.branchId].branchCode})`
                      : ''}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Site Type</span>
                  <span className="text-[#1F1916]">{viewingSite.siteType}</span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Site Status</span>
                  <span className={statusTextClass(viewingSite)}>{viewingSite.siteStatus}</span>
                </div>

                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Full Address</span>
                  <span className="text-[#1F1916]">
                    {viewingSite.fullAddress}, {viewingSite.city}, {viewingSite.state} —{' '}
                    <span className="font-mono-tabular">{viewingSite.pinCode}</span>
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Google Maps Location</span>
                  <a
                    href={buildGoogleMapsHref(
                      viewingSite.googleMapsLocation,
                      `${viewingSite.fullAddress}, ${viewingSite.city} ${viewingSite.pinCode}`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono-tabular text-xs font-semibold text-[#5C3D2E] hover:underline mt-0.5 break-all"
                  >
                    <span>
                      {viewingSite.googleMapsLocation || 'Open Address in Google Maps'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Site Contact Person</span>
                  <span className="font-medium text-[#1F1916]">
                    {viewingSite.siteContactPerson}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Site Manager Name</span>
                  <span className="font-medium text-[#1F1916]">{viewingSite.siteManagerName}</span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Manager Mobile</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {viewingSite.managerMobile}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Manager Email</span>
                  <span className="text-[#1F1916] break-all">{viewingSite.managerEmail}</span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">
                    Start Date &amp; Contract End Date
                  </span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {viewingSite.startDate} to {viewingSite.contractEndDate}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Created By &amp; Updated</span>
                  <span className="text-xs text-[#574B43]">
                    {viewingSite.createdBy} ·{' '}
                    <span className="font-mono-tabular">
                      {formatIsoDateTime(viewingSite.updatedAt)}
                    </span>
                  </span>
                </div>

                {viewingSite.notes && (
                  <div className="sm:col-span-3 pt-2 border-t border-[#E5DDD2]">
                    <span className="text-xs text-[#7D6F65] block">Operational Notes</span>
                    <p className="text-[#1F1916] mt-0.5">{viewingSite.notes}</p>
                  </div>
                )}
              </div>

              {/* Historical Change & Audit Trail */}
              {viewingSite.history && viewingSite.history.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-[#1F1916]">
                    Historical Change &amp; Audit Trail
                  </h3>
                  <ul className="divide-y divide-[#E5DDD2] border border-[#E5DDD2] rounded-xl bg-[#FAF8F5] px-4">
                    {viewingSite.history.map((h) => (
                      <li
                        key={h.id}
                        className="py-2.5 text-xs flex flex-wrap justify-between gap-2"
                      >
                        <div>
                          <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                            {h.action}
                          </span>{' '}
                          — <span className="text-[#1F1916]">{h.details}</span>{' '}
                          <span className="text-[#7D6F65]">
                            by {h.actorName} ({h.actorRole})
                          </span>
                        </div>
                        <span className="font-mono-tabular text-[#7D6F65]">
                          {formatIsoDateTime(h.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5DDD2] flex flex-wrap justify-end items-center gap-2 shrink-0">
              {canDeleteSite && !viewingSite.isArchived && (
                <button
                  type="button"
                  onClick={() => setArchiveTarget(viewingSite)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2]"
                >
                  Delete / Archive Site
                </button>
              )}

              {!canDeleteSite && !isAdmin && !viewingSite.isArchived && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteApprovalSite(viewingSite);
                    setDeleteApprovalReason('');
                    setDeleteApprovalErr(null);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E7DDD0]"
                >
                  Request Admin Deletion Approval
                </button>
              )}

              {canEditSite && !viewingSite.isArchived && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingSite;
                    setViewingSite(null);
                    openEditModal(target);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Edit Site Details
                </button>
              )}

              <button
                type="button"
                onClick={() => setViewingSite(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SITE SERVICE CONFIGURATION MODAL (SECURITY / HOUSEKEEPING / MANPOWER) */}
      {/* ===================================================================== */}
      {serviceConfigModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/55 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-service-config-title"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <h2
                  id="site-service-config-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  {editingConfig
                    ? `Edit Site Service Post — ${editingConfig.siteServiceId}`
                    : `Configure Service Line — ${configFormData.siteId}`}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {configFormData.siteName} · Select Service Category, Authorized Service,
                  Designation, Shift, and Headcount.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setServiceConfigModalOpen(false)}
                disabled={savingConfig}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close service configuration modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveServiceConfig(e)}
              className="p-5 sm:p-6 space-y-4"
              noValidate
            >
              {configFormError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{configFormError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Category <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.serviceCategory}
                    onChange={(e) =>
                      handleConfigCategoryChange(e.target.value as ServiceCategory)
                    }
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {SERVICE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.serviceId}
                    onChange={(e) => handleConfigServiceChange(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Service...</option>
                    {availableServicesForCategory.map((srv) => (
                      <option key={srv.serviceId} value={srv.serviceId}>
                        {srv.serviceName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Designation <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.designationId}
                    onChange={(e) => {
                      const dsg = designations.find((d) => d.designationId === e.target.value);
                      setConfigFormData((prev) => ({
                        ...prev,
                        designationId: dsg?.designationId ?? '',
                        designationName: dsg?.designationName ?? '',
                      }));
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Designation...</option>
                    {availableDesignationsForSelection.map((dsg) => (
                      <option key={dsg.designationId} value={dsg.designationId}>
                        {dsg.designationName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Headcount & Live Non-Negative Vacancy Calculation */}
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Required Employee Count <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={configFormData.requiredCount}
                    onChange={(e) => {
                      const val = Math.max(0, parseInt(e.target.value || '0', 10));
                      setConfigFormData((prev) => ({
                        ...prev,
                        requiredCount: Number.isNaN(val) ? 0 : val,
                      }));
                    }}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Deployed Count <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={configFormData.requiredCount}
                    value={configFormData.deployedCount}
                    onChange={(e) => {
                      const val = Math.max(0, parseInt(e.target.value || '0', 10));
                      setConfigFormData((prev) => ({
                        ...prev,
                        deployedCount: Number.isNaN(val) ? 0 : val,
                      }));
                    }}
                    className={`w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border rounded-lg focus:outline-none focus:bg-white ${
                      isConfigNegativeAttempt
                        ? 'border-[#B91C1C] text-[#B91C1C]'
                        : 'border-[#E5DDD2] focus:border-[#5C3D2E]'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Vacant Count (Auto)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={
                      isConfigNegativeAttempt
                        ? 'Blocked (Deployed > Required)'
                        : `${previewConfigVacancy} Vacant`
                    }
                    className={`w-full min-h-[42px] px-3.5 py-2 text-xs font-mono-tabular font-semibold rounded-lg border cursor-not-allowed ${
                      isConfigNegativeAttempt
                        ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                        : 'bg-[#F3EDE4] border-[#E5DDD2] text-[#5C3D2E]'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Shift Type <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.shiftType}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({ ...prev, shiftType: e.target.value }))
                    }
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {SHIFT_TYPES.map((sh) => (
                      <option key={sh} value={sh}>
                        {sh}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Working Hours <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.workingHours}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({ ...prev, workingHours: e.target.value }))
                    }
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {WORKING_HOURS_OPTIONS.map((wh) => (
                      <option key={wh} value={wh}>
                        {wh}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Weekly Off <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={configFormData.weeklyOff}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({ ...prev, weeklyOff: e.target.value }))
                    }
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {WEEKLY_OFF_OPTIONS.map((wo) => (
                      <option key={wo} value={wo}>
                        {wo}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Start Date <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="date"
                    value={configFormData.serviceStartDate}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({
                        ...prev,
                        serviceStartDate: e.target.value,
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service End Date <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="date"
                    value={configFormData.serviceEndDate}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({
                        ...prev,
                        serviceEndDate: e.target.value,
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Deployment Notes
                  </label>
                  <input
                    type="text"
                    maxLength={300}
                    value={configFormData.notes}
                    onChange={(e) =>
                      setConfigFormData((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    placeholder="Gate assignment, uniform / equipment instructions, reliever rules..."
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setServiceConfigModalOpen(false)}
                  disabled={savingConfig}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig || isConfigNegativeAttempt}
                  className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {savingConfig
                    ? 'Saving Post Line...'
                    : editingConfig
                      ? 'Update Service Post'
                      : 'Add Service Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HR Sensitive Site Deletion Approval Modal */}
      {deleteApprovalSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-del-apr-title"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="site-del-apr-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  Request Site Archival Approval
                </h3>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {deleteApprovalSite.siteId} — {deleteApprovalSite.siteName}. Direct Site deletion
                  requires <code className="font-mono-tabular">site.delete</code> or Administrator
                  sign-off.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteApprovalSite(null)}
                disabled={submittingApproval}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deleteApprovalErr && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                {deleteApprovalErr}
              </div>
            )}

            <form
              onSubmit={(e) => void handleSubmitDeleteApproval(e)}
              className="mt-4 space-y-4"
              noValidate
            >
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Reason for Site Archival <span className="text-[#B91C1C]">*</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={350}
                  value={deleteApprovalReason}
                  onChange={(e) => setDeleteApprovalReason(e.target.value)}
                  placeholder="e.g. Contract concluded with client handover completed on 31 Oct..."
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteApprovalSite(null)}
                  disabled={submittingApproval}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApproval}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submittingApproval ? 'Submitting...' : 'Submit for Admin Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Archive / Delete Dialog (Admin or HR with site.delete) */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={`Delete / Archive Site ${archiveTarget?.siteId ?? ''}?`}
        description={`"${archiveTarget?.siteName ?? ''}" (${archiveTarget?.clientName ?? ''}) will be marked Inactive and moved to Archived History so all historical attendance, payroll, and billing records remain intact.`}
        confirmLabel="Archive Site & Keep History"
        variant="danger"
        loading={archiving}
        onConfirm={() => void handleConfirmArchiveSite()}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Confirm Remove Site Service Post */}
      <ConfirmDialog
        open={Boolean(removeConfigTarget)}
        title={`Remove ${removeConfigTarget?.designationName ?? ''} Post Line?`}
        description={`Remove ${removeConfigTarget?.serviceCategory ?? ''} — ${removeConfigTarget?.designationName ?? ''} (${removeConfigTarget?.shiftType ?? ''}) from Site ${removeConfigTarget?.siteId ?? ''}?`}
        confirmLabel="Remove Post Line"
        variant="danger"
        loading={removingConfig}
        onConfirm={() => void handleConfirmRemoveConfig()}
        onCancel={() => setRemoveConfigTarget(null)}
      />
    </div>
  );
};
