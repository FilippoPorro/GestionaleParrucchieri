import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DashboardStats {
  data: string;
  slotCorrente: {
    inizio: string;
    fine: string;
  };
  appuntamentiOggi: number;
  incassoGiornaliero: number;
  incassoPrevistoAppuntamenti: number;
  prodottiInRiordino: number;
  clientiInSalone: number;
  sogliaRiordino: number;
  promemoria?: {
    appuntamenti: DashboardAppointmentReminder[];
    prodotti: DashboardProductReminder[];
  };
}

export interface DashboardAppointmentReminder {
  idAppuntamento: number;
  clienteNome: string;
  operatoreNome: string;
  ora: string;
  oraFine: string;
  servizio: string;
  stato: 'in_corso' | 'in_arrivo';
}

export interface DashboardProductReminder {
  idProdotto: number;
  nome: string;
  quantita: number;
}

export interface ReportChartDatum {
  label: string;
  value: number;
}

export interface ReportScatterDatum {
  label: string;
  value: number;
  delta: number;
}

export interface ReportRankDatum extends ReportChartDatum {
  id: number;
  quantity: number;
  revenue: number;
}

export interface ReportCustomerFrequencyDatum {
  id: number;
  name: string;
  appointments: number;
  monthlyFrequency: number;
  discount: number;
}

export interface ReportCustomerSegmentDatum {
  label: string;
  customers: number;
  appointments: number;
  averageSpend: number;
  revenue: number;
}

export interface ReportAgeDistributionDatum {
  label: string;
  count: number;
  percentage: number;
}

export interface ReportServiceDatum {
  label: string;
  quantity: number;
  revenue: number;
}

export interface ReportBusiestDayDatum {
  label: string;
  appointments: number;
  revenue: number;
  drivingSegment: string;
  drivingSegmentCount: number;
  drivingSegmentPercentage: number;
  revenuePercentage: number;
  rank: number;
}

export interface ReportOperatorPerformanceDatum {
  operatorId: number;
  name: string;
  tasks: number;
  revenue: number;
}

export interface ReportTopProductDatum {
  id: number;
  label: string;
  quantity: number;
  revenue: number;
  percentage: number;
}

export interface ReportData {
  range: {
    days: number;
    start: string;
    end: string;
  };
  summary: {
    totalRevenue: number;
    totalSales: number;
    averageTicket: number;
    totalProductsSold: number;
    totalCompletedAppointments: number;
  };
  charts: {
    revenueByCategory: ReportChartDatum[];
    paymentDistribution: ReportChartDatum[];
    weeklyRevenueTrend: ReportScatterDatum[];
  };
  payments: {
    total: number;
    card: number;
    cash: number;
  };
  customers: {
    frequency: ReportCustomerFrequencyDatum[];
    total: number;
    segments: ReportCustomerSegmentDatum[];
    averageAge: number;
    ageDistribution: ReportAgeDistributionDatum[];
  };
  services: {
    revenue: number;
    percentageOnSales: number;
    byType: ReportServiceDatum[];
  };
  traffic: {
    busiestDays: ReportBusiestDayDatum[];
  };
  operators: {
    performance: ReportOperatorPerformanceDatum[];
  };
  retail: {
    revenue: number;
    percentageOnSales: number;
    topProducts: ReportTopProductDatum[];
  };
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private api = `${environment.apiUrl}/dashboard`;

  constructor(private http: HttpClient) {}

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.api}/stats`);
  }

  getReport(days: number): Observable<ReportData> {
    return this.http.get<ReportData>(`${this.api}/report`, {
      params: { days: String(days) }
    });
  }
}
