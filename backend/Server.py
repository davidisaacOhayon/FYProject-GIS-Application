from unittest import result

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated
from datetime import date
from sqlmodel import SQLModel, Field, Session, create_engine, func, select
from sqlalchemy import text
from pydantic import BaseModel
import numpy as np 
from collections import Counter

import calendar
import datetime
import logging
from contextlib import asynccontextmanager
from sklearn.cluster import KMeans
from dotenv import load_dotenv

import pandas as pd
import os
import time
import math
# from pandasTest import getUsableDatasetLength
from stations import stationsTownMap, townsCoordinates
# ================= MODELS =================

class Pollutants(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    town: str | None = None
    no2_ugm3: float | None = None
    so_ugm3: float | None = None
    o_ugm3: float | None = None
    pm10_ugm3: float | None = None
    pm25_ugm3: float | None = None
    day: date | None = None


# ================= INTERNAL CLASS MODELS =================

class ClusterTownData():
    def __init__(self, town, data):
        self.town: str = town
        self.data: list = data


    def __str__(self):
        return f"Town: {self.town}, Data: {self.data}"

# ================= PAYLOAD MODELS =================

class TownsPayload(BaseModel):
    towns: list[str]

class TownsPollutantPayload(BaseModel):
    towns: list[str]
    pollutant: str

class TownPollutantPayload(BaseModel):
    town: str
    pollutant: str

class DiseaseRiskPayload(BaseModel):
    town: str
    risks: object

class DiseaseRiskTownsPayload(BaseModel):
    towns: list[str]
    risks: object

# ================= SERVER =================

logger = logging.getLogger('uvicorn.error')
logger.setLevel(logging.DEBUG)

class APIServer:
    def __init__(self, interpolate : bool = False, stations_only : bool = False):

        # Interpolate Datasets 
        self.interpolate = interpolate

        # Process only station readings
        self.stations_only = stations_only

        self.pollutantDBKeyMap = {
                "SO2" : "so_ugm3",
                "NO2" : "no2_ugm3",
                "PM10" : "pm10_ugm3",
                "PM25" : "pm25_ugm3",
                "O3" : "o_ugm3"
            }
 
        self.WHOThresholds = {
            "SO2" : 40,
            "NO2" : 40,
            "PM10" : 15,
            "PM25" : 5,
            "CO2" : 4,
            "O3": 60
        }

        load_dotenv(dotenv_path="./.env")

        # Ensure that the database URL is correctly set.
        self.db_url = f"mysql+pymysql://root:{os.getenv("DB_PASSWORD")}@localhost:{os.getenv("DB_PORT")}/{os.getenv("DB_NAME")}"

        self.engine = create_engine(self.db_url, echo=True)

        self.dirPath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Datasets")

        self.stations = ["Msida","St. Paul's Bay", "Gharb", "Attard", "Zejtun"]

        self.app = FastAPI(lifespan=self.lifespan)

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        if not self.check_db_connection():
            raise Exception("Database connection failed.")
        
        self.populate_db() if interpolate or stations_only else None

        self.register_routes()
    
    def __compute_risk(self, RR, CFPol, Pol):
        '''Computes Relative Risk Increase relative to a counterfactual pollutant reading CF'''
        # Compute CRF

        logger.debug(f"Computing risk with RR: {RR}, CFPol: {CFPol}, Pol: {Pol}")
        
        if RR == 0:
            return 0
        
        CRF = math.log(RR) / 10
        result = round((math.exp(CRF * (Pol - CFPol))), 2)
        logger.debug(f"Computed risk: {result} for RR: {RR}, CFPol: {CFPol}, Pol: {Pol}")

        return result

    def __cluster_town(self, input):
        
        _data = input.data
        _town = input.town

        # Present pollutant readings in an array
        polArray = np.array([[d["val"]] for d in _data])

        # Fit into clusters with K-means
        kmeans = KMeans(n_clusters=3, random_state=0, n_init="auto").fit(polArray)
        
        clusters = list(dict.fromkeys(kmeans.labels_))

        samples = [{"Month" : r["day"], "Value" : r["val"], "Cluster" : int(c)} for r,c in zip(_data, kmeans.labels_)]
        
        clusterGroups = { int(a) : [{"Month" : s["Month"], "Value" : s["Value"] } for s in samples if a == s["Cluster"] ] for a in clusters }
        
        clusterCounter = {}

        # Process Each Cluster
        for cluster in clusterGroups.keys():
            c = {}
            coverage = 0
            # Get months
            months = []
            #  Go through each set in cluster groups
            for s in clusterGroups[cluster]:
                # If the read month isn't recorded
                if s["Month"] not in months:
                    # Add to list
                    months.append(s["Month"])
            
            # Go through each month
            for month in months:
                # Count occurence
                dayCount = sum(1 for d in clusterGroups[cluster] if d["Month"] == month )
                # print(f"{month} : {dayCount}" )

                coverage += dayCount
                c[month[:3]] = dayCount

            minVal = min([s["Value"] for s in clusterGroups[cluster]])
            maxVal = max([s["Value"] for s in clusterGroups[cluster]])

            clusterCounter[cluster] = {"min": minVal, "max" : maxVal, "data": c, "coverage" : round((coverage / 365) * 100, 2)}

        # Sort Clusters (low,med,high exposure)
        clusterCounter = dict(sorted(clusterCounter.items(), key=lambda item: item[1]['max']))
        # Re-index clusters to order them by exposure level
        clusterCounter = {i : v for i,v in enumerate(clusterCounter.values())}

        # clusterCounter["coordinates"] = townsCoordinates[_town]

        return clusterCounter

    def __cleanDataFrame(self, df):
        '''Cleans the dataframe by handling NAN values, converting data types and grouping by date.'''  
        # Convert 'Date' & 'DatePM' column to datetime, coerce errors
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce', dayfirst=True)
        df['DatePM'] = pd.to_datetime(df['DatePM'], errors='coerce', dayfirst=True)
 
        # Drop rows where 'Date' is NaT
        df = df.dropna(subset=["Date"]) 
 

        # Convert all column names to numeric
        for col in df.columns:
            if col != 'Date' and col != 'DatePM':
                df[col] = pd.to_numeric(df[col], errors='coerce')

        # Fill NaN values in numeric columns with 0
        num_cols = df.select_dtypes(include="number").columns
    
        df[num_cols] = df[num_cols].fillna(0)

        # we will have to copy over
        # The daily aggregates of the PM readings.
        # Since ERA provided them to us in monthly aggregates.

        pm_df = df[['DatePM', 'PM2.5 (µg/m3)', 'PM10 (µg/m3)']].copy()

        # Group by 'Date' and calculate mean for numeric columns for each day (This assumes the datasets are provided in hourly aggregates)  
        df = df.groupby("Date", as_index=False).mean(numeric_only=True).round(2)
 
        return df, pm_df
   
    def __calculate_town_distance(self, lat1, lon1, lat2, lon2):
        '''Haversine formula to calculate distance between two lat/lon points
        Returns distance in km'''
        R = 6371.0  # km

        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)

        a = (
            math.sin(dphi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        )

        return 2 * R * math.asin(math.sqrt(a))

    def check_db_connection(self) -> bool:
        '''Checks if the database connection is successfully established.'''
        with Session(self.engine) as session:
            try:
                session.exec(select(Pollutants)).first()
                return True 
            except Exception as e:
                return False
            
    @asynccontextmanager
    async def lifespan(self, app: FastAPI):
        '''Lifespan function which handles startup code and shut down.'''
        print("Creating tables...", flush=True)
        SQLModel.metadata.create_all(self.engine)
        yield
        print("Shutdown complete.", flush=True)

    def populate_db(self):
        '''Will iterate through each file found within the defined file path,
           can handle xlsx files.'''
    
        files = os.listdir(self.dirPath)

        for file in files:
            # Get each file and it's extension within the dir
            filename, ext = os.path.splitext(file)
            print(f"{filename}  {ext}")

            match(ext):
                case ".xlsx": self.__handleXLSXFile(os.path.join(self.dirPath, file))
                case _: print("Invalid Dataset file found, skipping")

    def __getUsableDatasetLength(self, path):
        '''Checks the number of rows within the dataset file'''
        lengths = []
        for station in self.stations:
            df = pd.read_excel(path, sheet_name=station, na_values=['na'])
            # Optimize this please, we should really just clean the dataframe once.
            df, pm_df = self.__cleanDataFrame(df)
            print(df.shape)
            lengths.append(df.shape[0])

        print(f"Dataset lengths for each station: {lengths}")
        return min(lengths)
    
    def __populate_station_readings(self, path, stations):
        '''Processes the dataset readings to populate the DB with the station readings directly. No Interpolation
           Multiple datasets from multiple years can be extracted but make sure no collisions occur.
        '''
        with Session(self.engine) as session:

            # Keep track of usable dataset length (typically 365)
            lim = self.__getUsableDatasetLength(path)

            for station in stations:

                logger.debug(f"Processing station {station}, skipping interpolation")

                # Read Data set
                df = pd.read_excel(path, sheet_name=station, na_values=['na'])

                # Clean data frame by handling NAN values, converting data types and grouping by date
                # Contains main dataframe for NO2, SO2, O3 and a separate dataframe for PM10 and PM2.5
                df, pm_df = self.__cleanDataFrame(df)

                # For each day
                for row in range(0, lim):
                    townData = {}

                    townData['town'] = station

                    # Get date for current row
                    townData['Date'] = df.iloc[row]['Date']

                    print(df.columns)

                    # Simply access pollutant rows from dataset
                    townData["NO2 (µg/m3)"] = df.iloc[row]['NO2 (µg/m3)']
                    townData["SO2 (µg/m3)"] = df.iloc[row]['SO2 (µg/m3)']
                    townData["O3 (µg/m3)"] = df.iloc[row]['O3 (µg/m3)']
                    townData["PM10 (µg/m3)"] = pm_df.loc[pm_df['DatePM'] == townData['Date']]['PM10 (µg/m3)'].iloc[0]
                    townData["PM2.5 (µg/m3)"] = pm_df.loc[pm_df['DatePM'] == townData['Date']]['PM2.5 (µg/m3)'].iloc[0]

               
                    object = Pollutants(
                        no2_ugm3=townData["NO2 (µg/m3)"],
                        so_ugm3=townData["SO2 (µg/m3)"],
                        o_ugm3=townData["O3 (µg/m3)"],
                        pm10_ugm3 = townData['PM10 (µg/m3)'] if 'PM10 (µg/m3)' in townData else 0,
                        pm25_ugm3=townData["PM2.5 (µg/m3)"],
                        town=townData['town'],
                        day=townData['Date']
                    )
                    session.add(object)
                    
                
                session.commit()

    def __handleXLSXFile(self, path):   
        '''Will Handle XLSX File datasets'''
        with Session(self.engine) as session:
            mainData = {}

            towns = townsCoordinates.keys()

            # Keep track of stations (sheets)
            stations = pd.ExcelFile(path).sheet_names

            # Populate Station readings into DB
            self.__populate_station_readings(path, stations)

            # Check if user wants stations only
            if self.stations_only:
                return
            
            # Keep track of usable dataset length (typically 365)
            lim = self.__getUsableDatasetLength(path)


            print(f"Towns to process: {len(towns)}")
            pollutants = ['NO2 (µg/m3)', 'SO2 (µg/m3)', 'O3 (µg/m3)', 'PM10 (µg/m3)', 'PM2.5 (µg/m3)']
            timeNow = time.time()


            # Go through each town
            for town in towns:
                
                # Skip Stations
                if town in stations:
                    continue

                data = []

                print(f"Usable dataset length: {lim}")
             
                print(f"Handling pollution for {town} \n\n")
                # Iterate through each data row for the town and interpolate pollutant readings
                for row in range(0, lim):
                    townData = {}
                    townData['town'] = town
                    townLat, townLon = townsCoordinates[town]
                    
                    # go through each pollutant
                    for p in pollutants:
                        inverseDistance = 0
                        # Keep track of pollutant sum
                        pollutantSum = 0
                        print(f"Processing pollutant {p} for town {town} ---------------------------------------------------------------")

                        # Go through each station available
                        for station in self.stations:
                            # Read the station data 
                            df = pd.read_excel(path, sheet_name=station, na_values=['na'])
                            # Clean data frame by handling NAN values, converting data types and grouping by date
                            # Contains main dataframe for NO2, SO2, O3 and a separate dataframe for PM10 and PM2.5
                            df, pm_df = self.__cleanDataFrame(df)

                            # Get date for current row
                            townData['Date'] = df.iloc[row]['Date']
                            
                            # Get station coordinates
                            stationLat, stationLon = stationsTownMap[station]['coordinates']

                            # Calculated distance from station to current town
                            distance = round(self.__calculate_town_distance(townLat, townLon, stationLat, stationLon), 2)
                            
                            print(f"DISTANCE BETWEEN {town} AND {station} is {distance}")
                            # Check if we are accessing PM10 PM25
                            if (p == "PM10 (µg/m3)" or p == "PM2.5 (µg/m3)"):
                                # Access PM10 and PM2.5 rows of the current station and date
                                pollutantSum += pm_df.loc[pm_df['DatePM'] == townData['Date']][p].iloc[0] / distance

                                print(f"Summing THIS THINGY by { pm_df.loc[pm_df['DatePM'] == townData['Date']][p].iloc[0]} and {distance}")
                                # Average the PM Values
                                inverseDistance += 1 / distance

                                print(f"CURRENT PM2.5/PM10 SUM : {pollutantSum} with DISTANCE {inverseDistance}")
                                continue
                            else:
                                # Average the concentration values from each station for the current pollutant
                                try:
                                    pollutantSum += float(df.iloc[row][p] / distance) if df.iloc[row][p] != 0 else 0
                                    print(f"Pollutant value from station {station} for pollutant {p} is {df.iloc[row][p]} µg/m3, contributing {float(df.iloc[row][p] / distance) if df.iloc[row][p] != 0 else 0} µg/m3 to the town's pollutant sum")
                                    inverseDistance += 1 / distance
                                except Exception as e:
                                    print(f"Error accessing row {row} for station {station}, pollutant {p}: {e}")
                        print(f"PRODUCT OF THE CURRENT POLLUTANT WE ARE PRODUCING GRANTS US A SUM {pollutantSum} AND {inverseDistance} RESULTING IN {math.floor(( pollutantSum / inverseDistance ) * 100) / 100 if inverseDistance != 0 else 0} ")
                        townData[p] = math.floor(( pollutantSum / inverseDistance ) * 100) / 100 if inverseDistance != 0 else 0




                    data.append(townData)
                    object = Pollutants(
                        town = townData['town'],
                        no2_ugm3 = townData['NO2 (µg/m3)'],
                        so_ugm3 = townData['SO2 (µg/m3)'],
                        o_ugm3 = townData['O3 (µg/m3)'],
                        pm10_ugm3 = townData['PM10 (µg/m3)'] if 'PM10 (µg/m3)' in townData else 0,
                        pm25_ugm3 = townData['PM2.5 (µg/m3)'],
                        day = townData['Date']
                    )
                    session.add(object)
                    print(f"Finished processing row for town {town} and {townData['Date']}")
                    session.commit()

                print(f"Finished processing town: {town}")
                session.commit()
                

                

            timefinish = time.time()
            print(f"Time taken to process dataset: {timefinish - timeNow}")



            # mainData[town] = data

    def get_session(self):
        '''Individualizes each DB request within a session to prevent conflicts.'''
        with Session(self.engine) as session:
            yield session

    SessionDep = Annotated[Session, Depends(get_session)]

    def register_routes(self):
        '''Used to register each individual endpoint for the API server.
            \n **API End Points:**
            \n */getTownExpPolCluster/* - Clusters records of a town's annual pollutant reading
        '''

        @self.app.post("/getPolDistribution")
        def get_pol_distribution(pollutants : list[str]):
            '''Retrieves distribution of pollution readings'''
            # Get Mean
            mean = np.mean(pollutants)

            # Get Optimal Decimal points for scaling
            c = math.floor(mean * 100) / 100

        @self.app.post("/getDiseaseRisksTowns")
        def get_disease_risks_towns(payload: DiseaseRiskTownsPayload, session: Session = Depends(self.get_session)):
            '''Retrieves Relative risks of towns based on NO2, PM2.5 & PM10 readings'''

            towns = payload.towns
            risks = payload.risks

            logger.debug(f"Received payload for disease risks for towns: {payload.towns} with risks: {payload.risks}")  

            # Select average pollutants of all selected towns
            query = select(
                Pollutants.town,
                func.round(func.avg(Pollutants.so_ugm3), 3).label("SO2"),
                func.round(func.avg(Pollutants.o_ugm3), 3).label("O3"),
                func.round(func.avg(Pollutants.no2_ugm3), 3).label("NO2"),
                func.round(func.avg(Pollutants.pm10_ugm3), 3).label("PM10"),
                func.round(func.avg(Pollutants.pm25_ugm3), 3).label("PM25")
            ).where(Pollutants.town.in_(towns)).group_by(Pollutants.town)

            results = session.exec(query).mappings().all()

            logger.debug(f"retrieved these {results}")
            response = []
            for entry in results:
                logger.debug("Beginning computation")
                map = {
                    "SO2" : entry["SO2"],
                    "NO2" : entry["NO2"],
                    "PM10" : entry["PM10"],
                    "PM25" : entry["PM25"],
                    "O3" : entry["O3"]
                }

                # Calculate Disease Risks

                logger.debug(f"Beginning computation for {entry.town}")
                body = {
                        "Town" : entry.town,    
                        "CVD" : {
                            "PM25" : self.__compute_risk(risks["CVD"]["PM25"], self.WHOThresholds["PM25"], entry.PM25),
                            "PM10" : self.__compute_risk(risks["CVD"]["PM10"], self.WHOThresholds["PM10"], entry.PM10),
                            "NO2" : self.__compute_risk(risks["CVD"]["NO2"], self.WHOThresholds["NO2"], entry.NO2),
                            "O3" : self.__compute_risk(risks["CVD"]["O3"], self.WHOThresholds["O3"], entry.O3),
                            "SO2" : self.__compute_risk(risks["CVD"]["SO2"], self.WHOThresholds["SO2"], entry.SO2)
                        },
                        "RES" : {
                            "PM25" : self.__compute_risk(risks["RES"]["PM25"], self.WHOThresholds["PM25"], entry.PM25),
                            "PM10" : self.__compute_risk(risks["RES"]["PM10"], self.WHOThresholds["PM10"], entry.PM10),
                            "NO2" : self.__compute_risk(risks["RES"]["NO2"], self.WHOThresholds["NO2"], entry.NO2),
                            "O3" : self.__compute_risk(risks["RES"]["O3"], self.WHOThresholds["O3"], entry.O3),
                            "SO2" : self.__compute_risk(risks["RES"]["SO2"], self.WHOThresholds["SO2"], entry.SO2),
                        },
                        "LUNGC" : {
                            "PM25" : self.__compute_risk(risks["LUNGC"]["PM25"], self.WHOThresholds["PM25"], entry.PM25),
                            "PM10" : self.__compute_risk(risks["LUNGC"]["PM10"], self.WHOThresholds["PM10"], entry.PM10),
                            "NO2" : self.__compute_risk(risks["LUNGC"]["NO2"], self.WHOThresholds["NO2"], entry.NO2),
                            "O3" : self.__compute_risk(risks["LUNGC"]["O3"], self.WHOThresholds["O3"], entry.O3),
                            "SO2" : self.__compute_risk(risks["LUNGC"]["SO2"], self.WHOThresholds["SO2"], entry.SO2)
                        },
                        "COPD" : {
                            "PM25" : self.__compute_risk(risks["COPD"]["PM25"], self.WHOThresholds["PM25"], entry.PM25),
                            "PM10" : self.__compute_risk(risks["COPD"]["PM10"], self.WHOThresholds["PM10"], entry.PM10),
                            "NO2" : self.__compute_risk(risks["COPD"]["NO2"], self.WHOThresholds["NO2"], entry.NO2),
                            "O3" : self.__compute_risk(risks["COPD"]["O3"], self.WHOThresholds["O3"], entry.O3),
                            "SO2" : self.__compute_risk(risks["COPD"]["SO2"], self.WHOThresholds["SO2"], entry.SO2)
                        },
                        "IHD" : {
                            "PM25" : self.__compute_risk(risks["IHD"]["PM25"], self.WHOThresholds["PM25"], entry.PM25),
                            "PM10" : self.__compute_risk(risks["IHD"]["PM10"], self.WHOThresholds["PM10"], entry.PM10),
                            "NO2" : self.__compute_risk(risks["IHD"]["NO2"], self.WHOThresholds["NO2"], entry.NO2),
                            "O3" : self.__compute_risk(risks["IHD"]["O3"], self.WHOThresholds["O3"], entry.O3),
                            "SO2" : self.__compute_risk(risks["IHD"]["SO2"], self.WHOThresholds["SO2"], entry.SO2)
                        }
                    }

                logger.debug(f"Computed disease risks for town {entry.town}: {body}")
                response.append(body)

            return response

        @self.app.post("/getDiseaseRisks")
        def get_disease_risks(payload: DiseaseRiskPayload, session: Session = Depends(self.get_session)):
            ''' Will Retrieve the towns Relative Risk based on NO2, PM2.5 & PM10 readings.'''

            town = payload.town
            risks = payload.risks

            logger.debug(f"Received payload for disease risks: {payload.risks}")

            # Get Average NO2, PM10 and PM2.5 readings for the town
            query = select(
                func.round(func.avg(Pollutants.so_ugm3), 3).label("SO2"),
                func.round(func.avg(Pollutants.o_ugm3), 3).label("O3"),
                func.round(func.avg(Pollutants.no2_ugm3), 3).label("NO2"),
                func.round(func.avg(Pollutants.pm10_ugm3), 3).label("PM10"),
                func.round(func.avg(Pollutants.pm25_ugm3), 3).label("PM25")
            ).where(Pollutants.town == town)
 
            result = session.exec(query).first()

            map = {
                "SO2" : result.SO2,
                "NO2" : result.NO2,
                "PM10" : result.PM10,
                "PM25" : result.PM25,
                "O3" : result.O3
            }

            contents = {}

            for key in risks.keys():
                tempRisks = {"SO2" : 0, "NO2" : 0, "PM10" : 0, "PM25" : 0, "O3" : 0}
                for pol in ["SO2", "NO2", "PM10", "PM25", "O3"]:
                    
                    logger.debug(f"Processing disease: {key} for pollutant {pol}")
                    result = self.__compute_risk(risks[key][pol], self.WHOThresholds[pol], map[pol])
                    tempRisks[pol] = result
                    logger.debug(f"Computed risk for disease {key} and pollutant {pol}: {result}")
                
                logger.debug(f"Computed risks for disease {key}: {tempRisks}")
                contents[key] = tempRisks

            logger.debug(f"Computed disease risks: {contents}")
            return contents

        @self.app.get("/getTownsReadingsOnDate")
        def get_town_readings_date(date: date, session: Session = Depends(self.get_session)):
            '''Returns all towns pollutant readings on a specific date.'''
            query = select(Pollutants).where(Pollutants.day == date)
            return session.exec(query).all()
        
        @self.app.post("/getEDATownsPol")
        def get_eda_towns(payload: TownsPollutantPayload, session: Session = Depends(self.get_session)):
            '''Returns data processed for EDA of selected towns'''

            pol = payload.pollutant
            towns = payload.towns

            col = getattr(Pollutants, self.pollutantDBKeyMap[pol])

            query = (select(Pollutants.town,
                            func.round(func.avg(col), 3))
                    .where(Pollutants.town.in_(towns))
                    .group_by(Pollutants.town))
            
            results = session.exec(query).all()

            dataset = [{"town" : town, "avg" : avg} for town, avg in results]

            averages = [set["avg"] for set in dataset]

            # General statistics
            average = round(sum(avg for avg in averages) / len(results), 2)

            std = round(np.std([avg for avg in averages]), 3)

            range = round(max(averages) - min(averages), 3)

            # Exceedence rate
            count = 0
            for avg in averages:
                if avg > self.WHOThresholds[pol]:
                    count += 1
            
            ex_rate = round((count / len(results)), 2)

            # Worst Town & Best Town
            worst = max(dataset, key= lambda x : x["avg"])["town"]
            best =  min(dataset, key= lambda x : x["avg"])["town"]
             

            return {"Average" : average, "STD" : std, "ex_rate" : ex_rate, "worst": worst, "best" : best, "range": range}
                
        @self.app.get("/getEDATownPol")
        def get_eda_town_pol(town: str, pollutant: str, session: Session = Depends(self.get_session)):
            '''Returns all records of a town's pollutant readings for EDA purposes.'''
            
            # Get column of pollutant
            col = getattr(Pollutants, self.pollutantDBKeyMap[pollutant])

            query = (
                    select(
                        Pollutants.town,
                        col,
                        Pollutants.day
                    )
                    .where(Pollutants.town == town)
                )
            
            # Retrieve result
            result = session.exec(query).all()

            # Calculate Standard Deviation
            values = [getattr(r, col.key) for r in result]
            if values:
                std_dev = round(np.std(values), 3)
            else:
                std_dev = 0.0

            # Calculate Mean
            if values:
                mean = round(np.mean(values), 3)
            else:                
                mean = 0.0

            # Calculate Interquartile Range
            if values:
                q1 = round(np.percentile(values, 25), 3)
                q3 = round(np.percentile(values, 75), 3)
                iqr = round(q3 - q1, 3)
            else:
                iqr = 0.0

            # Retrieve Min Max Values
            if values:
                min = round(np.min(values), 3)
                max = round(np.max(values), 3)
            else:                
                min = 0.0
                max = 0.0

            
            return {"Q1": q1, "Q3": q3, "IQR" : iqr, "Mean": mean, "STD_Dev": std_dev, "Min": min, "Max": max}
        
        @self.app.get("/getTownExpPolClusters")
        def cluster_towns(pollutant: str, session: Session = Depends(self.get_session)):
            '''Clusters all towns by their yearly pollutant readings and return all cluster counts of all exposure levels.'''
            
            # Get column of pollutant
            col = getattr(Pollutants, self.pollutantDBKeyMap[pollutant])


            payload = []
            # Iterate through each town
            for town in ["Attard", "Mosta"]:
                query = (
                    select(Pollutants.town, col, Pollutants.day)
                    .where(Pollutants.town == town)
                )
                # Retrieve result
                result = session.exec(query).all()

                tempData = ClusterTownData(town = town, data=[{ "val": getattr(r, col.key), "day": calendar.month_name[pd.to_datetime(r.day).month]} for r in result])

                cluster = self.__cluster_town(tempData)
                for c in cluster:
                    cluster[c].pop("data", None)
                    cluster[c].pop("min", None)
                    cluster[c].pop("max", None)
                cluster["coordinates"] = townsCoordinates[town]

                payload.append(cluster)

            return payload

        @self.app.post("/getTownExpPolCluster/")
        def cluster_town(load: TownPollutantPayload, session: Session = Depends(self.get_session)):
            '''Clusters yearly pollution reading of town upon specific pollutant and returns cluster counts of all exposure levels.'''
           
            town = load.town
            pollutant = load.pollutant

            # Get column of pollutant
            col = getattr(Pollutants, self.pollutantDBKeyMap[pollutant])

            # Query for each record of town's pollutant reading.
            query = (
                    select(
                        Pollutants.town,
                        col,
                        Pollutants.day
                    )
                    .where(Pollutants.town == town)
                )
            
            # Retrieve result
            result = session.exec(query).all()

            tempData = ClusterTownData(town = town, data= [{ "val": getattr(r, col.key), "day": calendar.month_name[pd.to_datetime(r.day).month]} for r in result])

            cluster = self.__cluster_town(tempData)

            return cluster

        @self.app.get("/getTown/{id}")
        def get_town(id: int, session: Session = Depends(self.get_session)):
            '''Gets readings of town'''
            row = session.get(Pollutants, id)
            if not row:
                return {"error": "Not found"}
            return row

        @self.app.get("/getPollutantVolTown/")
        def get_pollutants_by_town(
            town: str,
            start_date: date | None = None,
            end_date: date | None = None,
            session: Session = Depends(self.get_session),
        ):
            '''Retrieves pollutant readings of a town.'''
            query = select(Pollutants).where(Pollutants.town == town)

            if start_date:
                query = query.where(Pollutants.day >= start_date)
            if end_date:
                query = query.where(Pollutants.day <= end_date)

            return session.exec(query.order_by(Pollutants.day)).all()

        @self.app.post("/getPollutantVolTowns/")
        def get_pollutants_by_towns(
            payload: TownsPayload,
            start_date: date | None = None,
            end_date: date | None = None,
            session: Session = Depends(self.get_session),
        ):
            '''Retrieves pollutant readings of selected towns.'''

            response = {}
            for town in payload.towns:
                query = select(Pollutants).where(Pollutants.town == town)
                # Apply date filters if provided
                if start_date:
                    query = query.where(Pollutants.day >= start_date)
                if end_date:
                    query = query.where(Pollutants.day <= end_date)
                townResult = session.exec(query.order_by(Pollutants.day)).all()
                response[town] = townResult



            return response
        
        @self.app.post("/getPollutantAvgTowns/")
        def get_pollutant_avg_towns(
            payload: TownsPollutantPayload,
            start_date: date | None = None,
            end_date: date | None = None,
            session: Session = Depends(self.get_session),
        ):
            '''Gets all Pollutant averages of selected towns.'''
            
            towns = payload.towns

            pollutant = payload.pollutant


            col = getattr(Pollutants, self.pollutantDBKeyMap[pollutant])
            
            query = (
                    select(
                        Pollutants.town,
                        func.round(func.avg(col), 3).label("avg")
                    )
                    .where(Pollutants.town.in_(towns))
                    .group_by(Pollutants.town)
                )

            if start_date:
                query = query.where(Pollutants.day >= start_date)
            if end_date:
                query = query.where(Pollutants.day <= end_date)

            return session.exec(query.order_by("avg")).mappings().all()
        
        @self.app.get("/getPollutantAvgsTown")
        def get_pollutant_avgs_town(
            town: str,
            session: Session = Depends(self.get_session)
        ):
            '''Returns all pollutant averages of a town'''
            query = select(
                func.round(func.avg(Pollutants.o_ugm3), 3).label("o3"),
                func.round(func.avg(Pollutants.no2_ugm3), 3).label("no2"),
                func.round(func.avg(Pollutants.pm10_ugm3), 3).label("pm10"),
                func.round(func.avg(Pollutants.pm25_ugm3), 3).label("pm25"),
                func.round(func.avg(Pollutants.so_ugm3), 3).label("so2")
            ).where(Pollutants.town == town)
 
            result = session.exec(query).first()

            logger.debug(f"Retrieved {result}")
            return {
                "NO2" : round(result._mapping.get("no2", 0), 2),
                "PM10" : round(result._mapping.get("pm10", 0), 2),
                "PM25" : round(result._mapping.get("pm25", 0), 2),
                "O3" : round(result._mapping.get("o3", 0), 2),
                "SO2" : round(result._mapping.get("so2", 0), 2)
            }

        @self.app.get("/getPollutantVol/")
        def get_pollutants(
            start_date: date | None = None,
            end_date: date | None = None,
            session: Session = Depends(self.get_session),
        ):
            '''Retrieves all pollution readings'''
            query = select(Pollutants)

            if start_date:
                query = query.where(Pollutants.day >= start_date)
            if end_date:
                query = query.where(Pollutants.day <= end_date)

            return session.exec(query.order_by(Pollutants.day)).all()

        @self.app.get("/getAvailableTownNames")
        def get_available_towns(session: Session = Depends(self.get_session)):
            '''Retrieves all town names that have available data'''
            query = select(Pollutants.town).distinct()
            return session.exec(query).all()

    
# ================= RUN =================
server = APIServer(interpolate=False, stations_only=False)
app = server.app
